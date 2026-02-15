import {
  ShannonMemory,
  IShannonMemory,
  MemoryCategory,
} from '../../models/ShannonMemory.js';

/** 容量制限 */
const MAX_EXPERIENCES = 500;
const MAX_KNOWLEDGE = 300;
const PROTECTED_IMPORTANCE = 8;

/** 体験の重複判定: 24時間以内のみ重複チェック */
const EXPERIENCE_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** jaccard 類似度の閾値 */
const EXPERIENCE_JACCARD_THRESHOLD = 0.5;
const KNOWLEDGE_JACCARD_THRESHOLD = 0.6;

export interface ShannonMemoryInput {
  category: MemoryCategory;
  content: string;
  feeling?: string;
  context?: string;
  source: string;
  importance: number;
  tags: string[];
}

export interface SaveResult {
  saved: boolean;
  message: string;
}

/**
 * ShannonMemoryService
 *
 * シャノン自身の長期記憶（体験・知識）の保存・検索
 * - 重複チェック付き保存 (体験: 時間ベース、知識: jaccard)
 * - 容量制限と自動削除
 * - 全文検索 + タグ検索
 */
export class ShannonMemoryService {
  private static instance: ShannonMemoryService;

  private constructor() {}

  public static getInstance(): ShannonMemoryService {
    if (!ShannonMemoryService.instance) {
      ShannonMemoryService.instance = new ShannonMemoryService();
    }
    return ShannonMemoryService.instance;
  }

  // ========== 保存 ==========

  /**
   * 重複チェック + 容量制限付き保存
   */
  async saveWithDedup(data: ShannonMemoryInput): Promise<SaveResult> {
    if (data.category === 'experience') {
      return this.saveExperienceWithDedup(data);
    }
    return this.saveKnowledgeWithDedup(data);
  }

  /**
   * 体験の保存 (24時間以内 + タグ類似で重複判定)
   */
  private async saveExperienceWithDedup(
    data: ShannonMemoryInput,
  ): Promise<SaveResult> {
    if (data.tags.length > 0) {
      const candidates = await ShannonMemory.find({
        category: 'experience',
        tags: { $in: data.tags },
        createdAt: {
          $gte: new Date(Date.now() - EXPERIENCE_DEDUP_WINDOW_MS),
        },
      })
        .sort({ createdAt: -1 })
        .limit(5);

      for (const existing of candidates) {
        const similarity = jaccardSimilarity(existing.tags, data.tags);
        if (similarity >= EXPERIENCE_JACCARD_THRESHOLD) {
          // 24時間以内 + タグ類似 → 重複
          if (data.feeling && data.feeling !== existing.feeling) {
            existing.feeling = data.feeling;
            await existing.save();
            return { saved: true, message: '感想を更新したよ' };
          }
          return { saved: false, message: 'もう覚えてるよ！' };
        }
      }
    }

    return this.createWithEviction(data);
  }

  /**
   * 知識の保存 (タグ jaccard で重複判定、時間制限なし)
   */
  private async saveKnowledgeWithDedup(
    data: ShannonMemoryInput,
  ): Promise<SaveResult> {
    if (data.tags.length > 0) {
      const candidates = await ShannonMemory.find({
        category: 'knowledge',
        tags: { $in: data.tags },
      })
        .sort({ createdAt: -1 })
        .limit(10);

      for (const existing of candidates) {
        if (
          jaccardSimilarity(existing.tags, data.tags) >=
          KNOWLEDGE_JACCARD_THRESHOLD
        ) {
          return { saved: false, message: 'もう知ってるよ！' };
        }
      }
    }

    return this.createWithEviction(data);
  }

  /**
   * 容量制限チェック + 作成
   */
  private async createWithEviction(
    data: ShannonMemoryInput,
  ): Promise<SaveResult> {
    await this.evictIfNeeded(data.category);

    await ShannonMemory.create({
      ...data,
      createdAt: new Date(),
    });

    return { saved: true, message: '覚えた！' };
  }

  // ========== 検索 ==========

  /**
   * 体験をキーワード検索
   */
  async searchExperiences(
    query: string,
    limit: number = 5,
  ): Promise<IShannonMemory[]> {
    return this.search('experience', query, limit);
  }

  /**
   * 知識をキーワード検索
   */
  async searchKnowledge(
    query: string,
    limit: number = 5,
  ): Promise<IShannonMemory[]> {
    return this.search('knowledge', query, limit);
  }

  /**
   * カテゴリ + キーワードで検索
   * タグ一致 → 全文検索 の順で試行
   */
  private async search(
    category: MemoryCategory,
    query: string,
    limit: number,
  ): Promise<IShannonMemory[]> {
    const keywords = query
      .split(/[\s,、。]+/)
      .filter((k) => k.length > 0);

    if (keywords.length === 0) {
      // キーワードなし: 重要度 + 日時で最新を返す
      return ShannonMemory.find({ category })
        .sort({ importance: -1, createdAt: -1 })
        .limit(limit)
        .lean();
    }

    // 1. タグ一致で検索
    const tagResults = await ShannonMemory.find({
      category,
      tags: { $in: keywords },
    })
      .sort({ importance: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    if (tagResults.length >= limit) {
      return tagResults;
    }

    // 2. 全文検索で補完
    try {
      const textResults = await ShannonMemory.find(
        {
          category,
          $text: { $search: keywords.join(' ') },
        },
        { score: { $meta: 'textScore' } },
      )
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit)
        .lean();

      // タグ結果と全文結果をマージ (重複除去)
      const seen = new Set(tagResults.map((r) => r._id.toString()));
      const merged = [...tagResults];
      for (const r of textResults) {
        if (!seen.has(r._id.toString())) {
          merged.push(r);
          if (merged.length >= limit) break;
        }
      }
      return merged;
    } catch {
      // text index がまだ作られていない場合はタグ結果のみ返す
      return tagResults;
    }
  }

  /**
   * 直近 + 重要な記憶を取得 (MemoryNode preProcess 用)
   */
  async getRecentImportant(
    category: MemoryCategory,
    limit: number = 5,
  ): Promise<IShannonMemory[]> {
    return ShannonMemory.find({
      category,
      importance: { $gte: 5 },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  // ========== 容量制限 ==========

  /**
   * 容量制限チェック。超過時は重要度が低く古いものから削除
   */
  private async evictIfNeeded(category: MemoryCategory): Promise<void> {
    const maxLimit = category === 'experience' ? MAX_EXPERIENCES : MAX_KNOWLEDGE;
    const count = await ShannonMemory.countDocuments({ category });

    if (count >= maxLimit) {
      const evicted = await ShannonMemory.findOneAndDelete(
        { category, importance: { $lt: PROTECTED_IMPORTANCE } },
        { sort: { importance: 1, createdAt: 1 } },
      );
      if (evicted) {
        console.log(
          `🗑 ShannonMemory eviction [${category}]: "${evicted.content.substring(0, 50)}" (importance: ${evicted.importance})`,
        );
      }
    }
  }

  // ========== フォーマット ==========

  /**
   * 記憶をプロンプト注入用の文字列に変換
   */
  formatForPrompt(
    experiences: IShannonMemory[],
    knowledge: IShannonMemory[],
  ): string {
    const lines: string[] = [];

    if (experiences.length > 0) {
      lines.push('【体験】');
      for (const exp of experiences) {
        const date = exp.createdAt.toLocaleDateString('ja-JP', {
          month: 'numeric',
          day: 'numeric',
        });
        const feeling = exp.feeling ? ` → ${exp.feeling}` : '';
        lines.push(`- [${date}] ${exp.content}${feeling}`);
      }
    }

    if (knowledge.length > 0) {
      lines.push('【知識】');
      for (const k of knowledge) {
        lines.push(`- ${k.content}`);
      }
    }

    return lines.join('\n');
  }
}

// ========== ユーティリティ ==========

/**
 * Jaccard 類似度
 */
function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a.map((s) => s.toLowerCase()));
  const setB = new Set(b.map((s) => s.toLowerCase()));
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

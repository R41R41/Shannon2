import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import {
  PersonMemory,
  IPersonMemory,
  IExchange,
  PrivacyZone,
  MemoryPlatform,
} from '../../models/PersonMemory.js';
import {
  resolveAlias,
  resolveMemberByPlatformId,
  MEMBER_ALIASES,
  MemberAlias,
} from '../../config/memberAliases.js';
import { config } from '../../config/env.js';
import { models } from '../../config/models.js';
import { loadPrompt } from '../llm/config/prompts.js';
import { logger } from '../../utils/logger.js';

/** 容量制限 */
const MAX_PERSON_RECORDS = 200;
const MAX_RECENT_EXCHANGES = 20;
const PROTECTED_INTERACTION_COUNT = 20;

/**
 * プラットフォームから privacyZone を導出
 */
export function platformToPrivacyZone(platform: MemoryPlatform): PrivacyZone {
  return platform === 'discord' || platform === 'minebot'
    ? 'internal'
    : 'external';
}

/**
 * PersonMemoryService
 *
 * 人物記憶の CRUD + 特徴抽出 + 要約 + エイリアス解決
 * privacyZone で internal / external を厳密に分離
 * コアメンバーは例外的に全プラットフォームで同一人物として扱う
 */
export class PersonMemoryService {
  private static instance: PersonMemoryService;
  private model: ChatOpenAI;
  private extractTraitsPrompt: string | null = null;

  private constructor() {
    // gpt-5-mini は temperature=1 のみサポート（デフォルト値を使用）
    this.model = new ChatOpenAI({
      modelName: models.contentGeneration,
      apiKey: config.openaiApiKey,
    });
  }

  public static getInstance(): PersonMemoryService {
    if (!PersonMemoryService.instance) {
      PersonMemoryService.instance = new PersonMemoryService();
    }
    return PersonMemoryService.instance;
  }

  public async initialize(): Promise<void> {
    this.extractTraitsPrompt = await loadPrompt('extract_person_traits');
  }

  // ========== 検索 ==========

  /**
   * platformUserId で検索 (内部処理用、最も正確)
   */
  async lookup(
    platform: MemoryPlatform,
    platformUserId: string,
  ): Promise<IPersonMemory | null> {
    return PersonMemory.findOne({ platform, platformUserId }).lean();
  }

  /**
   * 表示名で検索 (recall-person ツール用)
   * 1. コアメンバーのエイリアス解決
   * 2. privacyZone 内で displayName 検索
   */
  async lookupByName(
    currentPlatform: MemoryPlatform,
    name: string,
  ): Promise<IPersonMemory | null> {
    // 1. コアメンバーのエイリアス解決
    const member = resolveAlias(name);
    if (member) {
      return this.lookupCoreMember(member, currentPlatform);
    }

    // 2. 通常ユーザー: privacyZone 内で displayName 検索
    const zone = platformToPrivacyZone(currentPlatform);
    return PersonMemory.findOne({
      privacyZone: zone,
      displayName: { $regex: new RegExp(`^${this.escapeRegex(name)}$`, 'i') },
    })
      .sort({ lastSeenAt: -1 })
      .lean();
  }

  /**
   * コアメンバーを検索 (全プラットフォームのうち最新のレコードを返す)
   */
  private async lookupCoreMember(
    member: MemberAlias,
    preferredPlatform: MemoryPlatform,
  ): Promise<IPersonMemory | null> {
    // まず現在のプラットフォームで探す
    const preferredId = member.platformIds[preferredPlatform];
    if (preferredId) {
      const record = await PersonMemory.findOne({
        platform: preferredPlatform,
        platformUserId: preferredId,
      }).lean();
      if (record) return record;
    }

    // 見つからなければ他のプラットフォームで最新を返す
    for (const [platform, userId] of Object.entries(member.platformIds)) {
      if (platform === preferredPlatform) continue;
      const record = await PersonMemory.findOne({
        platform: platform as MemoryPlatform,
        platformUserId: userId,
      }).lean();
      if (record) return record;
    }

    return null;
  }

  // ========== 作成・更新 ==========

  /**
   * 初回接触時にレコードを作成、または既存レコードを返す
   */
  async getOrCreate(
    platform: MemoryPlatform,
    platformUserId: string,
    displayName: string,
  ): Promise<IPersonMemory> {
    const existing = await PersonMemory.findOne({ platform, platformUserId });
    if (existing) {
      // displayName が変わっていれば更新
      if (existing.displayName !== displayName) {
        existing.displayName = displayName;
        await existing.save();
      }
      return existing.toObject();
    }

    // 容量制限チェック
    await this.evictIfNeeded();

    const member = resolveMemberByPlatformId(platform, platformUserId);
    const zone = platformToPrivacyZone(platform);

    const record = await PersonMemory.create({
      privacyZone: zone,
      platform,
      platformUserId,
      displayName: member?.canonicalName ?? displayName,
      traits: [],
      notes: '',
      recentExchanges: [],
      conversationSummary: '',
      totalInteractions: 0,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    });

    return record.toObject();
  }

  /**
   * 会話後に人物記憶を更新
   * - recentExchanges に会話を追加
   * - 10往復を超えたら要約に圧縮
   * - 非同期で特徴抽出
   */
  async updateAfterConversation(
    platform: MemoryPlatform,
    platformUserId: string,
    displayName: string,
    newExchanges: IExchange[],
  ): Promise<void> {
    try {
      const record = await PersonMemory.findOne({ platform, platformUserId });
      if (!record) {
        // レコードがなければ作成してから更新
        await this.getOrCreate(platform, platformUserId, displayName);
        return this.updateAfterConversation(
          platform,
          platformUserId,
          displayName,
          newExchanges,
        );
      }

      // recentExchanges に追加
      record.recentExchanges.push(...newExchanges);
      record.totalInteractions += Math.ceil(newExchanges.length / 2);
      record.lastSeenAt = new Date();

      // 20メッセージ (10往復) を超えたら要約
      if (record.recentExchanges.length > MAX_RECENT_EXCHANGES) {
        const overflow = record.recentExchanges.splice(
          0,
          record.recentExchanges.length - MAX_RECENT_EXCHANGES,
        );
        const overflowText = overflow
          .map((e) => `${e.role}: ${e.content}`)
          .join('\n');

        const summary = await this.summarizeExchanges(
          overflowText,
          record.conversationSummary,
        );
        record.conversationSummary = summary;
      }

      await record.save();

      // 非同期で特徴抽出 (fire-and-forget)
      this.extractAndUpdateTraits(record).catch((err) => {
        logger.error('❌ 人物特徴抽出エラー', err);
      });
    } catch (error) {
      logger.error('❌ PersonMemory updateAfterConversation エラー', error);
    }
  }

  // ========== 特徴抽出・要約 ==========

  /**
   * 会話の要約を生成
   */
  private async summarizeExchanges(
    newExchanges: string,
    existingSummary: string,
  ): Promise<string> {
    const systemPrompt = `以下の会話と既存の要約を統合して、簡潔な要約を生成してください。
既存の要約に含まれる情報と新しい会話の情報を合わせて、1-3文でまとめてください。
重複する情報は省き、新しい発見があれば追加してください。`;

    const humanContent = existingSummary
      ? `【既存の要約】\n${existingSummary}\n\n【新しい会話】\n${newExchanges}`
      : `【会話】\n${newExchanges}`;

    const response = await this.model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(humanContent),
    ]);

    return response.content.toString().trim();
  }

  /**
   * 会話から人物の特徴を抽出して更新
   */
  private async extractAndUpdateTraits(
    record: InstanceType<typeof PersonMemory>,
  ): Promise<void> {
    const systemPrompt =
      this.extractTraitsPrompt ??
      `以下の会話内容から、このユーザーの特徴を抽出してください。
既存の特徴と重複しないもののみ出力してください。

出力形式 (JSON):
{
  "newTraits": ["特徴1", "特徴2"],
  "updatedNotes": "既存のnotesに追加すべき新しい情報（なければ空文字）"
}`;

    const conversationText = record.recentExchanges
      .map((e) => `${e.role}: ${e.content}`)
      .join('\n');

    if (!conversationText.trim()) return;

    const humanContent = `【ユーザー名】${record.displayName}
【既存の特徴】${record.traits.join(', ') || 'なし'}
【既存のメモ】${record.notes || 'なし'}
【直近の会話】
${conversationText}`;

    try {
      const response = await this.model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(humanContent),
      ]);

      const content = response.content.toString().trim();

      // JSON パース
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;

      const parsed = JSON.parse(jsonMatch[0]);

      // traits: $addToSet で重複防止
      if (parsed.newTraits && Array.isArray(parsed.newTraits)) {
        await PersonMemory.updateOne(
          { _id: record._id },
          { $addToSet: { traits: { $each: parsed.newTraits } } },
        );
      }

      // notes: 追記
      if (parsed.updatedNotes && typeof parsed.updatedNotes === 'string') {
        const existingNotes = record.notes || '';
        const newNotes = parsed.updatedNotes.trim();
        if (newNotes && !existingNotes.includes(newNotes)) {
          await PersonMemory.updateOne(
            { _id: record._id },
            {
              notes: existingNotes
                ? `${existingNotes}\n${newNotes}`
                : newNotes,
            },
          );
        }
      }
    } catch (error) {
      logger.error('❌ extractAndUpdateTraits パースエラー', error);
    }
  }

  // ========== 容量制限 ==========

  /**
   * 容量制限チェック。超過時は古い + やりとりの少ないレコードから削除
   */
  private async evictIfNeeded(): Promise<void> {
    const count = await PersonMemory.countDocuments();
    if (count >= MAX_PERSON_RECORDS) {
      const evicted = await PersonMemory.findOneAndDelete(
        { totalInteractions: { $lt: PROTECTED_INTERACTION_COUNT } },
        { sort: { lastSeenAt: 1 } },
      );
      if (evicted) {
        logger.info(
          `🗑 PersonMemory eviction: ${evicted.displayName} (${evicted.platform}, interactions: ${evicted.totalInteractions})`,
        );
      }
    }
  }

  // ========== ユーティリティ ==========

  /**
   * 人物記憶をプロンプト注入用の文字列に変換
   */
  formatForPrompt(person: IPersonMemory): string {
    const lines: string[] = [];
    lines.push(`## この人について (${person.displayName})`);

    if (person.traits.length > 0) {
      lines.push(`- 特徴: ${person.traits.join(', ')}`);
    }
    if (person.notes) {
      lines.push(`- メモ: ${person.notes}`);
    }
    if (person.conversationSummary) {
      lines.push(`- 過去の要約: ${person.conversationSummary}`);
    }
    if (person.recentExchanges.length > 0) {
      lines.push(`- 直近の会話:`);
      const recent = person.recentExchanges.slice(-6);
      for (const ex of recent) {
        const role = ex.role === 'user' ? person.displayName : 'シャノン';
        lines.push(`  ${role}: ${ex.content.substring(0, 100)}`);
      }
    }
    lines.push(`- 初回接触: ${person.firstSeenAt.toLocaleDateString('ja-JP')}`);
    lines.push(`- やりとり回数: ${person.totalInteractions}回`);

    return lines.join('\n');
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

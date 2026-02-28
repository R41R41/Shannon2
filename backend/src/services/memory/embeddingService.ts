import OpenAI from 'openai';
import { Types } from 'mongoose';
import { ShannonMemory, IShannonMemory, MemoryCategory } from '../../models/ShannonMemory.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const MIN_SIMILARITY_THRESHOLD = 0.3;

interface CachedMemory {
  id: string;
  embedding: number[];
  category: MemoryCategory;
  content: string;
  importance: number;
}

export interface SemanticSearchResult {
  memory: IShannonMemory;
  similarity: number;
}

/**
 * EmbeddingService
 *
 * OpenAI embedding の生成、インメモリキャッシュ、cosine similarity 検索を提供。
 * ShannonMemory (max 800件) の embedding をメモリ上にキャッシュし、
 * クエリ文の embedding との cosine similarity で高速検索する。
 */
export class EmbeddingService {
  private static instance: EmbeddingService;
  private openai: OpenAI;
  private cache: Map<string, CachedMemory> = new Map();
  private initialized = false;

  private constructor() {
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
  }

  public static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.loadCache();
    this.initialized = true;
  }

  /**
   * 起動時に全 ShannonMemory の embedding をロード
   */
  async loadCache(): Promise<void> {
    const memories = await ShannonMemory.find({ embedding: { $exists: true, $ne: [] } })
      .select('+embedding')
      .lean();

    this.cache.clear();
    for (const mem of memories) {
      if (mem.embedding && mem.embedding.length === EMBEDDING_DIMENSIONS) {
        this.cache.set(mem._id.toString(), {
          id: mem._id.toString(),
          embedding: mem.embedding,
          category: mem.category,
          content: mem.content,
          importance: mem.importance,
        });
      }
    }
    logger.info(`🧠 EmbeddingService: キャッシュロード完了 (${this.cache.size}件)`);
  }

  /**
   * テキストの embedding を生成
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    });
    return response.data[0].embedding;
  }

  /**
   * 複数テキストの embedding を一括生成
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    });
    return response.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }

  /**
   * キャッシュにエントリを追加/更新
   */
  updateCache(memoryId: Types.ObjectId, embedding: number[], category: MemoryCategory, content: string, importance: number): void {
    this.cache.set(memoryId.toString(), {
      id: memoryId.toString(),
      embedding,
      category,
      content,
      importance,
    });
  }

  /**
   * キャッシュからエントリを削除
   */
  removeFromCache(memoryId: string): void {
    this.cache.delete(memoryId);
  }

  /**
   * Semantic search: top-K 類似 + ランダムサンプル
   *
   * @param query ユーザーメッセージ等のクエリ文
   * @param topK 類似度上位の件数
   * @param randomN ランダムサンプル件数 (top-K に含まれないものから選出)
   * @param category カテゴリで絞る場合
   */
  async search(
    query: string,
    topK: number = 5,
    randomN: number = 2,
    category?: MemoryCategory,
  ): Promise<IShannonMemory[]> {
    if (this.cache.size === 0) return [];

    const queryEmbedding = await this.generateEmbedding(query);

    const scored: { id: string; similarity: number }[] = [];
    for (const [, entry] of this.cache) {
      if (category && entry.category !== category) continue;
      const sim = cosineSimilarity(queryEmbedding, entry.embedding);
      if (sim >= MIN_SIMILARITY_THRESHOLD) {
        scored.push({ id: entry.id, similarity: sim });
      }
    }

    scored.sort((a, b) => b.similarity - a.similarity);

    const topIds = scored.slice(0, topK).map((s) => s.id);
    const topIdSet = new Set(topIds);

    const remaining = scored.filter((s) => !topIdSet.has(s.id));
    const randomIds: string[] = [];
    if (remaining.length > 0 && randomN > 0) {
      const shuffled = [...remaining].sort(() => Math.random() - 0.5);
      for (let i = 0; i < Math.min(randomN, shuffled.length); i++) {
        randomIds.push(shuffled[i].id);
      }
    }

    const allIds = [...topIds, ...randomIds];
    if (allIds.length === 0) return [];

    const objectIds = allIds.map((id) => new Types.ObjectId(id));
    const memories = await ShannonMemory.find({ _id: { $in: objectIds } }).lean();

    const idOrder = new Map(allIds.map((id, i) => [id, i]));
    memories.sort((a, b) => (idOrder.get(a._id.toString()) ?? 0) - (idOrder.get(b._id.toString()) ?? 0));

    return memories;
  }

  get cacheSize(): number {
    return this.cache.size;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

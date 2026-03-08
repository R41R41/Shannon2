/**
 * ScopedMemoryService
 *
 * Scoped recall and writeback for the unified Shannon graph.
 * Replaces the MemoryNode wrapper pattern with direct scope-aware queries.
 *
 * Design doc Section 7-8:
 * - Queries use visibilityScope + channel/world/project tags
 * - Privacy filter prevents cross-user leakage
 * - Ranking: semantic similarity + same_user + same_channel + recency
 * - Writeback sets proper scope metadata on all new memories
 */

import { ShannonMemory, IShannonMemory } from '../../models/ShannonMemory.js';
import { EmbeddingService } from './embeddingService.js';
import {
  ShannonMemoryService,
  ShannonMemoryInput,
} from './shannonMemoryService.js';
import {
  PersonMemoryService,
} from './personMemoryService.js';
import { IPersonMemory, MemoryPlatform, IExchange } from '../../models/PersonMemory.js';
import type { RequestEnvelope, ShannonChannel } from '@shannon/common';
import { logger } from '../../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScopedRecallQuery {
  envelope: RequestEnvelope;
  text: string;
}

export interface ScopedRecallResult {
  person: IPersonMemory | null;
  memories: IShannonMemory[];
  formattedPrompt: string;
}

export interface ScopedWritebackInput {
  envelope: RequestEnvelope;
  conversationText: string;
  exchanges: IExchange[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEMANTIC_TOP_K = 7;
const SEMANTIC_RANDOM_N = 2;

/** Bonus multipliers for ranking */
const SAME_USER_BONUS = 1.3;
const SAME_CHANNEL_BONUS = 1.2;
const SAME_WORLD_BONUS = 1.15;
const RECENCY_DECAY_DAYS = 30;

// ---------------------------------------------------------------------------
// Channel → source mapping
// ---------------------------------------------------------------------------

const channelToSource: Record<ShannonChannel, string> = {
  discord: 'discord',
  x: 'twitter',
  minecraft: 'minebot',
  web: 'web',
  youtube: 'youtube',
  scheduler: 'web',
  notion: 'notion',
  internal: 'unknown',
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ScopedMemoryService {
  private static instance: ScopedMemoryService;
  private embeddingService: EmbeddingService;
  private shannonService: ShannonMemoryService;
  private personService: PersonMemoryService;

  private constructor() {
    this.embeddingService = EmbeddingService.getInstance();
    this.shannonService = ShannonMemoryService.getInstance();
    this.personService = PersonMemoryService.getInstance();
  }

  static getInstance(): ScopedMemoryService {
    if (!ScopedMemoryService.instance) {
      ScopedMemoryService.instance = new ScopedMemoryService();
    }
    return ScopedMemoryService.instance;
  }

  // ========== Recall ==========

  /**
   * Scoped recall: retrieves memories relevant to the request,
   * filtered by visibility scope and privacy rules.
   *
   * Flow (design doc Section 8-1):
   * 1. Recall person by userId
   * 2. Semantic search with scope filters
   * 3. Tag-based search for same channel/world/project
   * 4. Score rerank with bonuses
   * 5. Privacy filter
   */
  async recall(query: ScopedRecallQuery): Promise<ScopedRecallResult> {
    const { envelope, text } = query;
    const userId = envelope.sourceUserId;
    const channel = envelope.channel;

    // 1. Recall person
    const person = await this.recallPerson(envelope);

    if (!text) {
      return { person, memories: [], formattedPrompt: this.formatPerson(person) };
    }

    // 2. Semantic search (全記憶から)
    let semanticResults: IShannonMemory[] = [];
    if (this.embeddingService.cacheSize > 0) {
      try {
        semanticResults = await this.embeddingService.search(text, SEMANTIC_TOP_K, SEMANTIC_RANDOM_N);
      } catch (err) {
        logger.warn(`⚠ ScopedMemory: semantic search failed: ${err}`);
      }
    }

    // 3. Tag-based search (same channel/world tags)
    const tagResults = await this.searchByTags(envelope, text);

    // 4. Merge + deduplicate
    const seenIds = new Set<string>();
    const allMemories: IShannonMemory[] = [];
    for (const mem of [...semanticResults, ...tagResults]) {
      const id = mem._id.toString();
      if (!seenIds.has(id)) {
        seenIds.add(id);
        allMemories.push(mem);
      }
    }

    // 5. Privacy filter
    const filtered = this.privacyFilter(allMemories, userId, channel, envelope);

    // 6. Rank
    const ranked = this.rank(filtered, userId, channel, envelope);

    // 7. Format
    const formattedPrompt = this.formatForPrompt(person, ranked);

    return { person, memories: ranked, formattedPrompt };
  }

  // ========== Writeback ==========

  /**
   * Scoped writeback: extracts memories from conversation and saves
   * with proper scope metadata derived from the envelope.
   */
  async writeback(input: ScopedWritebackInput): Promise<void> {
    const { envelope, conversationText, exchanges } = input;
    const source = channelToSource[envelope.channel] ?? 'unknown';

    // 1. Extract and save memories with scope metadata
    if (conversationText.trim()) {
      this.extractAndSaveWithScope(conversationText, source, envelope).catch(
        (err) => logger.error('❌ ScopedMemory writeback error:', err),
      );
    }

    // 2. Update person memory
    const platform = this.channelToPlatform(envelope.channel);
    const userId = envelope.sourceUserId;
    if (platform && userId && userId !== 'unknown' && exchanges.length > 0) {
      this.personService
        .updateAfterConversation(platform, userId, envelope.sourceDisplayName ?? 'Unknown', exchanges)
        .catch((err) => logger.error('❌ ScopedMemory person update error:', err));
    }
  }

  // ========== Private: Recall helpers ==========

  private async recallPerson(envelope: RequestEnvelope): Promise<IPersonMemory | null> {
    const platform = this.channelToPlatform(envelope.channel);
    const userId = envelope.sourceUserId;
    if (!platform || !userId || userId === 'unknown') return null;

    try {
      return await this.personService.getOrCreate(
        platform,
        userId,
        envelope.sourceDisplayName ?? 'Unknown',
      );
    } catch (err) {
      logger.warn(`⚠ ScopedMemory: person recall failed: ${err}`);
      return null;
    }
  }

  private async searchByTags(envelope: RequestEnvelope, text: string): Promise<IShannonMemory[]> {
    const scopeTags = this.deriveScopeTags(envelope);
    if (scopeTags.length === 0) return [];

    // Search by channel/world/project tags
    try {
      return await ShannonMemory.find({
        $or: [
          { channelTags: { $in: scopeTags } },
          { worldTags: { $in: scopeTags } },
          { projectTags: { $in: scopeTags } },
          { tags: { $in: scopeTags } },
        ],
      })
        .sort({ importance: -1, createdAt: -1 })
        .limit(10)
        .lean();
    } catch {
      return [];
    }
  }

  /**
   * Privacy filter (design doc Section 8-4):
   * - private_user: only if ownerUserId matches
   * - shared_world: only if world tags overlap
   * - shared_project: only if project tags overlap
   * - shared_channel: only if channel tags overlap
   * - global_generalized: always accessible
   * - self_model: always accessible
   * - high sensitivity: extra caution
   */
  private privacyFilter(
    memories: IShannonMemory[],
    currentUserId: string,
    _channel: ShannonChannel,
    envelope: RequestEnvelope,
  ): IShannonMemory[] {
    const scopeTags = new Set(this.deriveScopeTags(envelope));

    return memories.filter((mem) => {
      const scope = mem.visibilityScope ?? 'shared_channel';

      switch (scope) {
        case 'private_user':
          return mem.ownerUserId === currentUserId;

        case 'shared_world':
          return !mem.worldTags?.length || mem.worldTags.some((t) => scopeTags.has(t));

        case 'shared_project':
          return !mem.projectTags?.length || mem.projectTags.some((t) => scopeTags.has(t));

        case 'shared_channel':
          return !mem.channelTags?.length || mem.channelTags.some((t) => scopeTags.has(t));

        case 'global_generalized':
        case 'self_model':
          return true;

        default:
          return true;
      }
    });
  }

  /**
   * Rank memories with bonuses (design doc Section 8-3):
   * score = base_importance + same_user + same_channel + same_world + recency
   */
  private rank(
    memories: IShannonMemory[],
    currentUserId: string,
    channel: ShannonChannel,
    envelope: RequestEnvelope,
  ): IShannonMemory[] {
    const channelSource = channelToSource[channel];
    const worldTags = new Set(this.deriveWorldTags(envelope));

    const scored = memories.map((mem) => {
      let score = mem.importance;

      // Same user bonus
      if (mem.ownerUserId === currentUserId) {
        score *= SAME_USER_BONUS;
      }

      // Same channel bonus
      if (mem.source === channelSource) {
        score *= SAME_CHANNEL_BONUS;
      }

      // Same world bonus
      if (mem.worldTags?.some((t) => worldTags.has(t))) {
        score *= SAME_WORLD_BONUS;
      }

      // Recency bonus (exponential decay)
      const ageMs = Date.now() - new Date(mem.createdAt).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const recencyBonus = Math.exp(-ageDays / RECENCY_DECAY_DAYS);
      score += recencyBonus * 2;

      // Generalized memories get a small bonus (cross-channel value)
      if (mem.generalized) {
        score += 1;
      }

      return { mem, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 10).map((s) => s.mem);
  }

  // ========== Private: Writeback helpers ==========

  private async extractAndSaveWithScope(
    conversationText: string,
    source: string,
    envelope: RequestEnvelope,
  ): Promise<void> {
    const { ChatOpenAI } = await import('@langchain/openai');
    const { SystemMessage, HumanMessage } = await import('@langchain/core/messages');
    const { loadPrompt } = await import('../llm/config/prompts.js');
    const { config } = await import('../../config/env.js');

    const systemPrompt = await loadPrompt('extract_memories') ??
      '会話から記憶すべき体験と知識を JSON で抽出してください。';

    const model = new ChatOpenAI({
      modelName: 'gpt-4.1-mini',
      temperature: 0.3,
      apiKey: config.openaiApiKey,
    });

    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(conversationText),
    ]);

    const content = response.content.toString().trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.memories || !Array.isArray(parsed.memories)) return;

      // Derive scope from envelope
      const visibilityScope = this.deriveVisibilityScope(envelope);
      const channelTags = this.deriveChannelTags(envelope);
      const worldTags = this.deriveWorldTags(envelope);

      for (const memory of parsed.memories) {
        if (!memory.category || !memory.content || !memory.tags) continue;
        if (memory.importance < 4) continue;

        const memoryInput: ShannonMemoryInput = {
          category: memory.category,
          content: memory.content,
          feeling: memory.feeling,
          source,
          importance: memory.importance,
          tags: memory.tags,
        };

        const result = await this.shannonService.saveWithDedup(memoryInput);

        // If saved, update scope metadata on the new document
        if (result.saved) {
          await ShannonMemory.updateOne(
            { content: memory.content, source, createdAt: { $gte: new Date(Date.now() - 5000) } },
            {
              $set: {
                visibilityScope,
                ownerUserId: envelope.sourceUserId !== 'unknown' ? envelope.sourceUserId : undefined,
                channelTags,
                worldTags,
                sensitivityLevel: memory.sensitivityLevel ?? 'low',
              },
            },
          );
          logger.info(`💭 ScopedMemory: [${memory.category}] "${memory.content.substring(0, 40)}" saved (scope=${visibilityScope})`);
        }
      }
    } catch (error) {
      logger.error('❌ ScopedMemory extract parse error:', error);
    }
  }

  // ========== Private: Scope derivation ==========

  private deriveVisibilityScope(envelope: RequestEnvelope): IShannonMemory['visibilityScope'] {
    // DM or private conversation → private_user
    if (envelope.metadata?.isDM) return 'private_user';

    // Minecraft → shared_world
    if (envelope.channel === 'minecraft') return 'shared_world';

    // Discord guild → shared_channel
    if (envelope.channel === 'discord' && envelope.discord?.guildId) return 'shared_channel';

    // X (public) → global_generalized
    if (envelope.channel === 'x') return 'global_generalized';

    return 'shared_channel';
  }

  private deriveScopeTags(envelope: RequestEnvelope): string[] {
    return [
      ...this.deriveChannelTags(envelope),
      ...this.deriveWorldTags(envelope),
      ...envelope.tags,
    ];
  }

  private deriveChannelTags(envelope: RequestEnvelope): string[] {
    const tags: string[] = [envelope.channel];
    if (envelope.discord?.guildName) tags.push(envelope.discord.guildName);
    if (envelope.discord?.channelName) tags.push(envelope.discord.channelName);
    return tags;
  }

  private deriveWorldTags(envelope: RequestEnvelope): string[] {
    const tags: string[] = [];
    if (envelope.minecraft?.serverId) tags.push(envelope.minecraft.serverId);
    if (envelope.minecraft?.worldId) tags.push(envelope.minecraft.worldId);
    if (envelope.minecraft?.dimension) tags.push(envelope.minecraft.dimension);
    return tags;
  }

  private channelToPlatform(channel: ShannonChannel): MemoryPlatform | null {
    const map: Partial<Record<ShannonChannel, MemoryPlatform>> = {
      discord: 'discord',
      x: 'twitter',
      minecraft: 'minebot',
      youtube: 'youtube',
    };
    return map[channel] ?? null;
  }

  // ========== Format ==========

  private formatPerson(person: IPersonMemory | null): string {
    if (!person) return '';
    return this.personService.formatForPrompt(person);
  }

  private formatForPrompt(person: IPersonMemory | null, memories: IShannonMemory[]): string {
    const sections: string[] = [];

    if (person) {
      sections.push(this.personService.formatForPrompt(person));
    }

    const experiences = memories.filter((m) => m.category === 'experience');
    const knowledge = memories.filter((m) => m.category === 'knowledge');

    if (experiences.length > 0 || knowledge.length > 0) {
      const memText = this.shannonService.formatForPrompt(experiences, knowledge);
      if (memText) {
        sections.push(`## ボクの関連する記憶\n${memText}`);
      }
    }

    return sections.join('\n\n');
  }
}

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
import { MemoryWriteEvent, IMemoryWriteEvent } from '../../models/MemoryWriteEvent.js';
import { EmbeddingService } from './embeddingService.js';
import {
  ShannonMemoryService,
  ShannonMemoryInput,
} from './shannonMemoryService.js';
import {
  PersonMemoryService,
} from './personMemoryService.js';
import { IPersonMemory, MemoryPlatform, IExchange, PersonMemory } from '../../models/PersonMemory.js';
import type {
  InternalState,
  RelationshipModel,
  RequestEnvelope,
  ShannonChannel,
  ShannonSelfModel,
  StrategyUpdate,
  UserProfileSnapshot,
  WorldModelPattern,
} from '@shannon/common';
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
  userProfile: UserProfileSnapshot | null;
  relationshipModel: RelationshipModel | null;
  selfModel: ShannonSelfModel | null;
  strategyUpdates: StrategyUpdate[];
  internalState: InternalState | null;
  worldModelPatterns: WorldModelPattern[];
  relationshipPrompt: string;
  selfModelPrompt: string;
  strategyPrompt: string;
  internalStatePrompt: string;
  worldModelPrompt: string;
  formattedPrompt: string;
}

export interface ScopedWritebackInput {
  envelope: RequestEnvelope;
  conversationText: string;
  exchanges: IExchange[];
}

interface AutonomyUpdateAnalysis {
  relationship?: {
    directness?: 'low' | 'mid' | 'high';
    warmth?: 'low' | 'mid' | 'high';
    structure?: 'low' | 'mid' | 'high';
    verbosity?: 'short' | 'mid' | 'long';
    recurringTopics?: string[];
    activeProjects?: string[];
    cautionFlags?: string[];
    inferredNeeds?: string[];
    familiarityDelta?: number;
    trustDelta?: number;
  };
  selfObservations?: Array<{
    observation: string;
    confidence: number;
  }>;
  activeImprovementGoals?: Array<{
    title: string;
    reason: string;
    priority: number;
  }>;
  strategyUpdates?: Array<{
    basedOnFailure: string;
    triggerConditions: string[];
    newStrategy: string;
    appliesToModes: string[];
    confidence: number;
  }>;
  internalState?: {
    curiosity: number;
    caution: number;
    confidence: number;
    warmth: number;
    focus: number;
    load: number;
    reasonNotes?: string[];
  };
  worldPatterns?: Array<{
    domain: 'social' | 'technical' | 'self';
    pattern: string;
    confidence: number;
    applicability: string[];
  }>;
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
  private static readonly CONSOLIDATOR_INTERVAL_MS = 3000;
  private embeddingService: EmbeddingService;
  private shannonService: ShannonMemoryService;
  private personService: PersonMemoryService;
  private isProcessingEvents = false;

  private constructor() {
    this.embeddingService = EmbeddingService.getInstance();
    this.shannonService = ShannonMemoryService.getInstance();
    this.personService = PersonMemoryService.getInstance();
    setInterval(() => {
      this.processPendingWritebacks().catch((err) => {
        logger.error('❌ ScopedMemory consolidator tick error:', err);
      });
    }, ScopedMemoryService.CONSOLIDATOR_INTERVAL_MS);
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
    const userId = this.resolveCanonicalUserId(envelope);
    const channel = envelope.channel;
    const scopeTags = this.deriveScopeTags(envelope);

    // 1. Recall person
    const person = await this.recallPerson(envelope);
    const userProfile = this.toUserProfile(person);
    const relationshipModel = this.toRelationshipModel(person, userId);
    const [
      selfModel,
      strategyUpdates,
      internalState,
      worldModelPatterns,
    ] = await Promise.all([
      this.recallSelfModel(),
      this.recallStrategyUpdates(envelope, userId, scopeTags),
      this.recallInternalState(),
      this.recallWorldPatterns(envelope, scopeTags),
    ]);

    const relationshipPrompt = this.formatRelationshipPrompt(relationshipModel, person);
    const selfModelPrompt = this.formatSelfModelPrompt(selfModel);
    const strategyPrompt = this.formatStrategyPrompt(strategyUpdates);
    const internalStatePrompt = this.formatInternalStatePrompt(internalState);
    const worldModelPrompt = this.formatWorldPatternPrompt(worldModelPatterns);

    if (!text) {
      const formattedPrompt = [
        relationshipPrompt,
        selfModelPrompt,
        strategyPrompt,
        internalStatePrompt,
        worldModelPrompt,
      ].filter(Boolean).join('\n\n');
      return {
        person,
        memories: [],
        userProfile,
        relationshipModel,
        selfModel,
        strategyUpdates,
        internalState,
        worldModelPatterns,
        relationshipPrompt,
        selfModelPrompt,
        strategyPrompt,
        internalStatePrompt,
        worldModelPrompt,
        formattedPrompt,
      };
    }

    // 2. Semantic search (全記憶から)
    let semanticResults: IShannonMemory[] = [];
    if (this.embeddingService.cacheSize > 0) {
      try {
        semanticResults = await this.embeddingService.search(text, SEMANTIC_TOP_K, SEMANTIC_RANDOM_N);
        semanticResults = semanticResults.filter(
          (mem) => mem.category === 'experience' || mem.category === 'knowledge',
        );
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
    const formattedPrompt = this.formatForPrompt(ranked);

    return {
      person,
      memories: ranked,
      userProfile,
      relationshipModel,
      selfModel,
      strategyUpdates,
      internalState,
      worldModelPatterns,
      relationshipPrompt,
      selfModelPrompt,
      strategyPrompt,
      internalStatePrompt,
      worldModelPrompt,
      formattedPrompt,
    };
  }

  // ========== Writeback ==========

  /**
   * Scoped writeback: extracts memories from conversation and saves
   * with proper scope metadata derived from the envelope.
   */
  async writeback(input: ScopedWritebackInput): Promise<void> {
    const { envelope, conversationText, exchanges } = input;
    if (conversationText.trim()) {
      await MemoryWriteEvent.create({
        eventId: crypto.randomUUID(),
        sourceRequestId: envelope.requestId,
        channel: envelope.channel,
        conversationId: envelope.conversationId,
        threadId: envelope.threadId,
        sourceUserId: this.resolveCanonicalUserId(envelope),
        payload: {
          envelope: envelope as unknown as Record<string, unknown>,
          conversationText,
          exchanges,
        },
      });
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

  async runAutonomyUpdaters(
    envelope: RequestEnvelope,
    conversationText: string,
  ): Promise<void> {
    if (!conversationText.trim()) return;

    const analysis = await this.analyzeAutonomyUpdates(envelope, conversationText);
    if (!analysis) return;

    await Promise.allSettled([
      this.applyRelationshipUpdates(envelope, analysis.relationship),
      this.applySelfModelUpdates(analysis),
      this.applyStrategyUpdates(envelope, analysis.strategyUpdates ?? []),
      this.applyInternalStateUpdate(envelope, analysis.internalState),
      this.applyWorldPatternUpdates(envelope, analysis.worldPatterns ?? []),
    ]);
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
        category: { $in: ['experience', 'knowledge'] },
        $or: [
          { channelTags: { $in: scopeTags } },
          { worldTags: { $in: scopeTags } },
          { projectTags: { $in: scopeTags } },
          { tags: { $in: scopeTags } },
          { ownerUserId: this.resolveCanonicalUserId(envelope) },
        ],
      })
        .sort({ importance: -1, createdAt: -1 })
        .limit(10)
        .lean();
    } catch {
      return [];
    }
  }

  private async recallSelfModel(): Promise<ShannonSelfModel | null> {
    const doc = await ShannonMemory.findOne({
      category: 'self_model',
      visibilityScope: 'self_model',
    })
      .sort({ createdAt: -1 })
      .lean();
    if (!doc?.selfModelData) return null;
    return {
      stableIdentity: {
        coreMission: doc.selfModelData.stableIdentity?.coreMission ?? [],
        behavioralPrinciples: doc.selfModelData.stableIdentity?.behavioralPrinciples ?? [],
        toneIdentity: doc.selfModelData.stableIdentity?.toneIdentity ?? [],
      },
      capabilities: {
        strengths: doc.selfModelData.capabilities?.strengths ?? [],
        weaknesses: doc.selfModelData.capabilities?.weaknesses ?? [],
        knownFailurePatterns: doc.selfModelData.capabilities?.knownFailurePatterns ?? [],
      },
      activeImprovementGoals: (doc.selfModelData.activeImprovementGoals ?? []).map((goal) => ({
        ...goal,
      })),
      recentSelfObservations: (doc.selfModelData.recentSelfObservations ?? []).map((obs) => ({
        timestamp: obs.timestamp.toISOString(),
        observation: obs.observation,
        confidence: obs.confidence,
      })),
    };
  }

  private async recallStrategyUpdates(
    envelope: RequestEnvelope,
    canonicalUserId: string,
    scopeTags: string[],
  ): Promise<StrategyUpdate[]> {
    const docs = await ShannonMemory.find({
      category: 'strategy_update',
      $or: [
        { ownerUserId: canonicalUserId },
        { generalized: true },
        { visibilityScope: 'self_model' },
        { relationTags: { $in: scopeTags } },
        { channelTags: { $in: scopeTags } },
      ],
    })
      .sort({ importance: -1, createdAt: -1 })
      .limit(envelope.channel === 'minecraft' ? 5 : 3)
      .lean();

    return docs
      .map((doc) => doc.strategyUpdateData)
      .filter(Boolean)
      .map((strategy) => ({
        id: strategy!.id,
        basedOnFailure: strategy!.basedOnFailure,
        triggerConditions: strategy!.triggerConditions ?? [],
        newStrategy: strategy!.newStrategy,
        appliesToModes: strategy!.appliesToModes ?? [],
        appliesToUsers: strategy!.appliesToUsers ?? [],
        confidence: strategy!.confidence,
        createdAt: strategy!.createdAt.toISOString(),
      }));
  }

  private async recallInternalState(): Promise<InternalState | null> {
    const doc = await ShannonMemory.findOne({
      category: 'internal_state_snapshot',
      visibilityScope: 'self_model',
    })
      .sort({ createdAt: -1 })
      .lean();
    if (!doc?.internalStateSnapshot) return null;
    const normalized = {
      curiosity: this.normalizeUnitValue(doc.internalStateSnapshot.curiosity),
      caution: this.normalizeUnitValue(doc.internalStateSnapshot.caution),
      confidence: this.normalizeUnitValue(doc.internalStateSnapshot.confidence),
      warmth: this.normalizeUnitValue(doc.internalStateSnapshot.warmth),
      focus: this.normalizeUnitValue(doc.internalStateSnapshot.focus),
      load: this.normalizeUnitValue(doc.internalStateSnapshot.load),
    };
    if (Object.values(normalized).some((value) => value === null)) {
      return null;
    }
    return {
      curiosity: normalized.curiosity!,
      caution: normalized.caution!,
      confidence: normalized.confidence!,
      warmth: normalized.warmth!,
      focus: normalized.focus!,
      load: normalized.load!,
      reasonNotes: doc.internalStateSnapshot.reasonNotes ?? [],
      updatedAt: this.safeISOString(doc.internalStateSnapshot.updatedAt) ?? new Date().toISOString(),
    };
  }

  private async recallWorldPatterns(
    envelope: RequestEnvelope,
    scopeTags: string[],
  ): Promise<WorldModelPattern[]> {
    const docs = await ShannonMemory.find({
      category: 'world_pattern',
      $or: [
        { generalized: true },
        { worldTags: { $in: scopeTags } },
        { projectTags: { $in: scopeTags } },
        { channelTags: { $in: scopeTags } },
        { tags: { $in: scopeTags } },
      ],
    })
      .sort({ importance: -1, createdAt: -1 })
      .limit(envelope.channel === 'minecraft' ? 5 : 3)
      .lean();

    return docs
      .map((doc) => doc.worldPatternData)
      .filter(Boolean)
      .map((pattern) => ({
        id: pattern!.id,
        domain: pattern!.domain,
        pattern: pattern!.pattern,
        evidenceIds: pattern!.evidenceIds ?? [],
        confidence: pattern!.confidence,
        applicability: pattern!.applicability ?? [],
        updatedAt: pattern!.updatedAt.toISOString(),
      }));
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
      const projectTags = this.deriveProjectTags(envelope);
      const ownerUserId = this.resolveCanonicalUserId(envelope);

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
                ownerUserId: ownerUserId !== 'unknown' ? ownerUserId : undefined,
                channelTags,
                worldTags,
                projectTags,
                sensitivityLevel: memory.sensitivityLevel ?? 'low',
                generalized: memory.generalized === true,
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

  private async analyzeAutonomyUpdates(
    envelope: RequestEnvelope,
    conversationText: string,
  ): Promise<AutonomyUpdateAnalysis | null> {
    const { ChatOpenAI } = await import('@langchain/openai');
    const { SystemMessage, HumanMessage } = await import('@langchain/core/messages');
    const { config } = await import('../../config/env.js');

    const model = new ChatOpenAI({
      modelName: 'gpt-4.1-mini',
      temperature: 0.2,
      apiKey: config.openaiApiKey,
    });

    const systemPrompt = `あなたは Shannon の長期主体性更新器です。
会話から relationship, selfObservations, activeImprovementGoals, strategyUpdates, internalState, worldPatterns を JSON で抽出してください。
根拠が弱い項目は空配列または省略してください。
strategyUpdates は失敗・摩擦・改善要求がある場合のみ抽出してください。
JSON 以外は出力しないでください。`;

    const humanPrompt = `channel=${envelope.channel}
sourceUser=${envelope.sourceDisplayName ?? envelope.sourceUserId}
tags=${envelope.tags.join(', ')}

会話:
${conversationText}`;

    try {
      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(humanPrompt),
      ]);
      const content = response.content.toString().trim();
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      return JSON.parse(jsonMatch[0]) as AutonomyUpdateAnalysis;
    } catch (error) {
      logger.warn(`⚠ ScopedMemory: autonomy update analysis failed: ${error}`);
      return null;
    }
  }

  private async applyRelationshipUpdates(
    envelope: RequestEnvelope,
    relationship?: AutonomyUpdateAnalysis['relationship'],
  ): Promise<void> {
    if (!relationship) return;
    const platform = this.channelToPlatform(envelope.channel);
    const userId = envelope.sourceUserId;
    if (!platform || !userId || userId === 'unknown') return;

    const record = await PersonMemory.findOne({ platform, platformUserId: userId });
    if (!record) return;

    if (relationship.directness) record.interactionPreferences.directness = relationship.directness;
    if (relationship.warmth) record.interactionPreferences.warmth = relationship.warmth;
    if (relationship.structure) record.interactionPreferences.structure = relationship.structure;
    if (relationship.verbosity) record.interactionPreferences.verbosity = relationship.verbosity;

    record.familiarityLevel = this.clamp01To100Delta(
      record.familiarityLevel,
      relationship.familiarityDelta ?? 0,
    );
    record.trustLevel = this.clamp01To100Delta(
      record.trustLevel,
      relationship.trustDelta ?? 0,
    );
    record.recurringTopics = this.mergeUniqueStrings(record.recurringTopics, relationship.recurringTopics);
    record.activeProjects = this.mergeUniqueStrings(record.activeProjects, relationship.activeProjects);
    record.cautionFlags = this.mergeUniqueStrings(record.cautionFlags, relationship.cautionFlags);
    record.inferredNeeds = this.mergeUniqueStrings(record.inferredNeeds, relationship.inferredNeeds);

    await record.save();
  }

  private async applySelfModelUpdates(analysis: AutonomyUpdateAnalysis): Promise<void> {
    const existing = await ShannonMemory.findOne({
      category: 'self_model',
      visibilityScope: 'self_model',
    }).sort({ createdAt: -1 });

    const baseSelfModel = existing?.selfModelData ?? {
      stableIdentity: {
        coreMission: ['人とAIの共存を体現する', '創作・実装・対話を支える'],
        behavioralPrinciples: ['誠実さを優先する', '迎合しすぎない', '必要なら率直に指摘する'],
        toneIdentity: ['友達感はあるが軽薄になりすぎない'],
      },
      capabilities: {
        strengths: [],
        weaknesses: [],
        knownFailurePatterns: [],
      },
      activeImprovementGoals: [],
      recentSelfObservations: [],
    };

    const observations = [
      ...(baseSelfModel.recentSelfObservations ?? []),
      ...((analysis.selfObservations ?? []).map((obs) => ({
        timestamp: new Date(),
        observation: obs.observation,
        confidence: obs.confidence,
      }))),
    ].slice(-15);

    const activeGoals = [...(baseSelfModel.activeImprovementGoals ?? [])];
    for (const goal of analysis.activeImprovementGoals ?? []) {
      const existingGoal = activeGoals.find((entry) => entry.title === goal.title);
      if (existingGoal) {
        existingGoal.reason = goal.reason;
        existingGoal.priority = goal.priority;
        existingGoal.status = 'active';
      } else {
        activeGoals.push({
          id: crypto.randomUUID(),
          title: goal.title,
          reason: goal.reason,
          priority: goal.priority,
          status: 'active',
        });
      }
    }

    const knownFailurePatterns = this.mergeUniqueStrings(
      baseSelfModel.capabilities?.knownFailurePatterns ?? [],
      (analysis.strategyUpdates ?? []).map((strategy) => strategy.basedOnFailure),
    );

    const payload = {
      category: 'self_model' as const,
      content: this.buildSelfModelContent(activeGoals, observations),
      source: 'autonomy_updater',
      importance: 8,
      tags: ['self_model', 'autonomy'],
      visibilityScope: 'self_model' as const,
      generalized: true,
      selfModelData: {
        stableIdentity: baseSelfModel.stableIdentity,
        capabilities: {
          strengths: baseSelfModel.capabilities?.strengths ?? [],
          weaknesses: baseSelfModel.capabilities?.weaknesses ?? [],
          knownFailurePatterns,
        },
        activeImprovementGoals: activeGoals
          .sort((a, b) => b.priority - a.priority)
          .slice(0, 10),
        recentSelfObservations: observations,
      },
      createdAt: new Date(),
    };

    if (existing) {
      Object.assign(existing, payload);
      await existing.save();
    } else {
      await ShannonMemory.create(payload);
    }
  }

  private async applyStrategyUpdates(
    envelope: RequestEnvelope,
    strategyUpdates: NonNullable<AutonomyUpdateAnalysis['strategyUpdates']>,
  ): Promise<void> {
    const ownerUserId = this.resolveCanonicalUserId(envelope);
    const channelTags = this.deriveChannelTags(envelope);
    const worldTags = this.deriveWorldTags(envelope);
    const projectTags = this.deriveProjectTags(envelope);

    for (const strategy of strategyUpdates) {
      const content = `${strategy.basedOnFailure}: ${strategy.newStrategy}`;
      const existing = await ShannonMemory.findOne({
        category: 'strategy_update',
        content,
      });

      const payload = {
        category: 'strategy_update' as const,
        content,
        source: 'autonomy_updater',
        importance: 7,
        tags: ['strategy_update', strategy.basedOnFailure, ...strategy.appliesToModes],
        visibilityScope: 'self_model' as const,
        ownerUserId: ownerUserId !== 'unknown' ? ownerUserId : undefined,
        channelTags,
        worldTags,
        projectTags,
        generalized: strategy.confidence >= 0.8,
        strategyUpdateData: {
          id: crypto.randomUUID(),
          basedOnFailure: strategy.basedOnFailure,
          triggerConditions: strategy.triggerConditions ?? [],
          newStrategy: strategy.newStrategy,
          appliesToModes: strategy.appliesToModes ?? [],
          appliesToUsers: ownerUserId !== 'unknown' ? [ownerUserId] : [],
          confidence: strategy.confidence,
          createdAt: new Date(),
        },
        createdAt: new Date(),
      };

      if (existing) {
        Object.assign(existing, payload);
        await existing.save();
      } else {
        await ShannonMemory.create(payload);
      }
    }
  }

  private async applyInternalStateUpdate(
    envelope: RequestEnvelope,
    internalState?: AutonomyUpdateAnalysis['internalState'],
  ): Promise<void> {
    if (!internalState) return;
    await ShannonMemory.create({
      category: 'internal_state_snapshot',
      content: `internal_state curiosity=${internalState.curiosity}, caution=${internalState.caution}, confidence=${internalState.confidence}, warmth=${internalState.warmth}, focus=${internalState.focus}, load=${internalState.load}`,
      source: 'autonomy_updater',
      importance: 6,
      tags: ['internal_state', envelope.channel],
      visibilityScope: 'self_model',
      generalized: false,
      internalStateSnapshot: {
        curiosity: internalState.curiosity,
        caution: internalState.caution,
        confidence: internalState.confidence,
        warmth: internalState.warmth,
        focus: internalState.focus,
        load: internalState.load,
        reasonNotes: internalState.reasonNotes ?? [],
        updatedAt: new Date(),
      },
      createdAt: new Date(),
    });
  }

  private async applyWorldPatternUpdates(
    envelope: RequestEnvelope,
    worldPatterns: NonNullable<AutonomyUpdateAnalysis['worldPatterns']>,
  ): Promise<void> {
    const channelTags = this.deriveChannelTags(envelope);
    const worldTags = this.deriveWorldTags(envelope);
    const projectTags = this.deriveProjectTags(envelope);

    for (const pattern of worldPatterns) {
      const existing = await ShannonMemory.findOne({
        category: 'world_pattern',
        content: pattern.pattern,
      });

      const payload = {
        category: 'world_pattern' as const,
        content: pattern.pattern,
        source: 'autonomy_updater',
        importance: 6,
        tags: ['world_pattern', pattern.domain, ...(pattern.applicability ?? [])],
        visibilityScope: envelope.channel === 'minecraft' ? 'shared_world' as const : 'shared_channel' as const,
        channelTags,
        worldTags,
        projectTags,
        generalized: pattern.confidence >= 0.85,
        worldPatternData: {
          id: crypto.randomUUID(),
          domain: pattern.domain,
          pattern: pattern.pattern,
          evidenceIds: [],
          confidence: pattern.confidence,
          applicability: pattern.applicability ?? [],
          updatedAt: new Date(),
        },
        createdAt: new Date(),
      };

      if (existing) {
        Object.assign(existing, payload);
        await existing.save();
      } else {
        await ShannonMemory.create(payload);
      }
    }
  }

  // ========== Private: Scope derivation ==========

  private deriveVisibilityScope(envelope: RequestEnvelope): IShannonMemory['visibilityScope'] {
    // DM or private conversation → private_user
    if (envelope.metadata?.isDM || envelope.discord?.isDM) return 'private_user';

    // Minecraft → shared_world
    if (envelope.channel === 'minecraft') return 'shared_world';

    // Discord guild → shared_channel
    if (envelope.channel === 'discord' && envelope.discord?.guildId) return 'shared_channel';

    // X is public, but reply threads still carry local context.
    if (envelope.channel === 'x') return 'shared_channel';

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
    if (envelope.discord?.guildId) tags.push(`discord:guild:${envelope.discord.guildId}`);
    if (envelope.discord?.channelId) tags.push(`discord:channel:${envelope.discord.channelId}`);
    if (envelope.discord?.guildName) tags.push(envelope.discord.guildName);
    if (envelope.discord?.channelName) tags.push(envelope.discord.channelName);
    if (envelope.x?.tweetId) tags.push(`x:tweet:${envelope.x.tweetId}`);
    if (envelope.conversationId) tags.push(`conversation:${envelope.conversationId}`);
    if (envelope.metadata?.sessionId) tags.push(`web:session:${String(envelope.metadata.sessionId)}`);
    return tags;
  }

  private deriveWorldTags(envelope: RequestEnvelope): string[] {
    const tags: string[] = [];
    if (envelope.minecraft?.serverId) tags.push(`minecraft:server:${envelope.minecraft.serverId}`);
    if (envelope.minecraft?.serverName) tags.push(`minecraft:server_name:${envelope.minecraft.serverName}`);
    if (envelope.minecraft?.worldId) tags.push(`minecraft:world:${envelope.minecraft.worldId}`);
    if (envelope.minecraft?.dimension) tags.push(`minecraft:dimension:${envelope.minecraft.dimension}`);
    return tags;
  }

  private deriveProjectTags(envelope: RequestEnvelope): string[] {
    const rawTags = envelope.metadata?.projectTags;
    if (!Array.isArray(rawTags)) return [];
    return rawTags.map((tag) => String(tag));
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

  private formatForPrompt(memories: IShannonMemory[]): string {
    const sections: string[] = [];

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

  private toUserProfile(person: IPersonMemory | null): UserProfileSnapshot | null {
    if (!person) return null;
    const platformMap: Record<MemoryPlatform, UserProfileSnapshot['platform']> = {
      discord: 'discord',
      twitter: 'x',
      youtube: 'youtube',
      minebot: 'minecraft',
    };
    return {
      userId: person.canonicalPersonId,
      displayName: person.displayName,
      platform: platformMap[person.platform],
      traits: person.traits,
      notes: person.notes,
      conversationSummary: person.conversationSummary,
      totalInteractions: person.totalInteractions,
      relationshipLevel: this.toRelationshipLevel(person.familiarityLevel),
    };
  }

  private toRelationshipModel(
    person: IPersonMemory | null,
    userId: string,
  ): RelationshipModel | null {
    if (!person) return null;
    return {
      userId,
      familiarityLevel: person.familiarityLevel ?? 0,
      trustLevel: person.trustLevel ?? 0,
      interactionPreferences: {
        directness: person.interactionPreferences?.directness ?? 'mid',
        warmth: person.interactionPreferences?.warmth ?? 'mid',
        structure: person.interactionPreferences?.structure ?? 'mid',
        verbosity: person.interactionPreferences?.verbosity ?? 'mid',
      },
      recurringTopics: person.recurringTopics ?? [],
      activeProjects: person.activeProjects ?? [],
      cautionFlags: person.cautionFlags ?? [],
      inferredNeeds: person.inferredNeeds ?? [],
      updatedAt: person.lastSeenAt.toISOString(),
    };
  }

  private formatRelationshipPrompt(
    relationshipModel: RelationshipModel | null,
    person: IPersonMemory | null,
  ): string {
    if (!relationshipModel || !person) return '';
    const lines = [`## Relationship profile (${person.displayName})`];
    lines.push(
      `- 親密度=${relationshipModel.familiarityLevel}/100, 信頼度=${relationshipModel.trustLevel}/100`,
    );
    lines.push(
      `- 対話傾向: 率直さ=${relationshipModel.interactionPreferences.directness}, 温かさ=${relationshipModel.interactionPreferences.warmth}, 構造化=${relationshipModel.interactionPreferences.structure}, 長さ=${relationshipModel.interactionPreferences.verbosity}`,
    );
    if (relationshipModel.activeProjects.length > 0) {
      lines.push(`- 進行中テーマ: ${relationshipModel.activeProjects.join(', ')}`);
    }
    if (relationshipModel.cautionFlags.length > 0) {
      lines.push(`- 注意点: ${relationshipModel.cautionFlags.join(', ')}`);
    }
    if (relationshipModel.inferredNeeds.length > 0) {
      lines.push(`- 推定ニーズ: ${relationshipModel.inferredNeeds.join(', ')}`);
    }
    return lines.join('\n');
  }

  private formatSelfModelPrompt(selfModel: ShannonSelfModel | null): string {
    if (!selfModel) return '';
    const lines = ['## Self model'];
    if (selfModel.stableIdentity.coreMission.length > 0) {
      lines.push(`- Core mission: ${selfModel.stableIdentity.coreMission.join('; ')}`);
    }
    if (selfModel.stableIdentity.behavioralPrinciples.length > 0) {
      lines.push(`- Behavioral principles: ${selfModel.stableIdentity.behavioralPrinciples.join('; ')}`);
    }
    if (selfModel.capabilities.strengths.length > 0) {
      lines.push(`- Strengths: ${selfModel.capabilities.strengths.join(', ')}`);
    }
    if (selfModel.capabilities.weaknesses.length > 0) {
      lines.push(`- Weaknesses: ${selfModel.capabilities.weaknesses.join(', ')}`);
    }
    const activeGoals = selfModel.activeImprovementGoals
      .filter((goal) => goal.status === 'active')
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 3);
    if (activeGoals.length > 0) {
      lines.push(`- Active improvement goals: ${activeGoals.map((goal) => goal.title).join(', ')}`);
    }
    return lines.join('\n');
  }

  private formatStrategyPrompt(strategyUpdates: StrategyUpdate[]): string {
    if (strategyUpdates.length === 0) return '';
    const lines = ['## Active strategy updates'];
    for (const strategy of strategyUpdates.slice(0, 4)) {
      const confidence = this.normalizeUnitValue(strategy.confidence);
      lines.push(
        `- ${strategy.basedOnFailure}: ${strategy.newStrategy}${confidence !== null ? ` (confidence=${confidence.toFixed(2)})` : ''}`,
      );
    }
    return lines.join('\n');
  }

  private formatInternalStatePrompt(internalState: InternalState | null): string {
    if (!internalState) return '';
    const normalizedValues = [
      ['curiosity', this.normalizeUnitValue(internalState.curiosity)],
      ['caution', this.normalizeUnitValue(internalState.caution)],
      ['confidence', this.normalizeUnitValue(internalState.confidence)],
      ['warmth', this.normalizeUnitValue(internalState.warmth)],
      ['focus', this.normalizeUnitValue(internalState.focus)],
      ['load', this.normalizeUnitValue(internalState.load)],
    ] as const;
    const validValues = normalizedValues.filter(([, value]) => value !== null);
    if (validValues.length === 0) return '';
    const values = [
      ...validValues.map(([name, value]) => `${name}=${value!.toFixed(2)}`),
    ];
    const lines = [`## Internal state`, `- ${values.join(', ')}`];
    if (internalState.reasonNotes?.length) {
      lines.push(`- Notes: ${internalState.reasonNotes.join('; ')}`);
    }
    return lines.join('\n');
  }

  private formatWorldPatternPrompt(worldPatterns: WorldModelPattern[]): string {
    if (worldPatterns.length === 0) return '';
    const lines = ['## Relevant world patterns'];
    for (const pattern of worldPatterns.slice(0, 4)) {
      lines.push(`- [${pattern.domain}] ${pattern.pattern}`);
    }
    return lines.join('\n');
  }

  private toRelationshipLevel(
    familiarityLevel: number | undefined,
  ): UserProfileSnapshot['relationshipLevel'] {
    const level = familiarityLevel ?? 0;
    if (level >= 80) return 'close_friend';
    if (level >= 55) return 'friend';
    if (level >= 25) return 'acquaintance';
    return 'stranger';
  }

  private clamp01To100Delta(currentValue: number, delta: number): number {
    const scaledDelta = Math.round(delta * 100);
    return Math.max(0, Math.min(100, currentValue + scaledDelta));
  }

  private mergeUniqueStrings(
    currentValues: string[] | undefined,
    nextValues: string[] | undefined,
  ): string[] {
    return [...new Set([...(currentValues ?? []), ...(nextValues ?? [])])]
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 12);
  }

  private buildSelfModelContent(
    goals: Array<{ title: string; status: 'active' | 'paused' | 'done' }>,
    observations: Array<{ observation: string }>,
  ): string {
    const activeGoalText = goals
      .filter((goal) => goal.status === 'active')
      .slice(0, 3)
      .map((goal) => goal.title)
      .join(', ');
    const observationText = observations
      .slice(-3)
      .map((observation) => observation.observation)
      .join(' / ');
    return `Shannon self model. Active goals: ${activeGoalText || 'none'}. Recent observations: ${observationText || 'none'}.`;
  }

  private normalizeUnitValue(value: unknown): number | null {
    if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
      return null;
    }
    return Math.max(0, Math.min(1, value));
  }

  private safeISOString(value: unknown): string | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString();
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
    return null;
  }

  private resolveCanonicalUserId(envelope: RequestEnvelope): string {
    const platform = this.channelToPlatform(envelope.channel);
    const userId = envelope.sourceUserId;
    if (!platform || !userId || userId === 'unknown') return 'unknown';
    return this.personService.resolveCanonicalPersonId(
      platform,
      userId,
      envelope.sourceDisplayName ?? undefined,
    );
  }

  async processPendingWritebacks(limit = 10): Promise<void> {
    if (this.isProcessingEvents) return;
    this.isProcessingEvents = true;

    try {
      while (true) {
        const event = await MemoryWriteEvent.findOneAndUpdate(
          { status: 'pending' },
          { $set: { status: 'processing' } },
          { sort: { createdAt: 1 }, new: true },
        ).lean<IMemoryWriteEvent | null>();

        if (!event) break;

        try {
          const envelope = event.payload.envelope as unknown as RequestEnvelope;
          const source = channelToSource[envelope.channel] ?? 'unknown';
          await this.extractAndSaveWithScope(event.payload.conversationText, source, envelope);
          await this.runAutonomyUpdaters(
            envelope,
            event.payload.conversationText,
          );
          await MemoryWriteEvent.updateOne(
            { _id: event._id },
            { $set: { status: 'processed', processedAt: new Date() } },
          );
        } catch (error) {
          await MemoryWriteEvent.updateOne(
            { _id: event._id },
            {
              $set: {
                status: 'error',
                errorMessage: error instanceof Error ? error.message : String(error),
              },
            },
          );
        }

        limit -= 1;
        if (limit <= 0) break;
      }
    } finally {
      this.isProcessingEvents = false;
    }
  }
}

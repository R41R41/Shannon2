/**
 * Shannon Unified Multi-Channel Graph Types
 *
 * Phase 1: Core type definitions for the unified Shannon graph architecture.
 * These types define the RequestEnvelope, unified graph state, action plans,
 * memory items, and supporting types needed to consolidate all channels
 * (Discord, X, Minecraft, Web) into a single core graph.
 *
 * Design principles:
 * - 1 identity, 1 core graph, N channel adapters
 * - Scoped shared memory with tags
 * - Per-request parallel execution
 * - Async memory consolidation
 */
import { EmotionType, TaskTreeState, HierarchicalSubTask, ActionItem } from './taskGraph.js';
/** All interaction surfaces Shannon can operate on. */
export type ShannonChannel = 'discord' | 'x' | 'minecraft' | 'web' | 'youtube' | 'scheduler' | 'notion' | 'internal';
/** Execution mode that drives graph routing decisions. */
export type ShannonMode = 'conversational' | 'task_execution' | 'planning' | 'minecraft_action' | 'minecraft_emergency' | 'broadcast' | 'self_reflection' | 'voice_conversation';
/** Attachment included with a request. */
export interface RequestAttachment {
    type: 'image' | 'audio' | 'video' | 'file';
    url?: string;
    data?: string;
    mimeType?: string;
    filename?: string;
}
/** Minecraft-specific context snapshot at request time. */
export interface MinecraftContext {
    serverId?: string;
    serverName?: string;
    worldId?: string;
    dimension?: string;
    biome?: string;
    position?: {
        x: number;
        y: number;
        z: number;
    };
    health?: number;
    food?: number;
    nearbyEntities?: string[];
    inventory?: Array<{
        name: string;
        count: number;
    }>;
    eventType?: 'chat' | 'mentioned' | 'attacked' | 'observed' | 'task_result' | 'death' | 'system';
}
/** Discord-specific context. */
export interface DiscordContext {
    guildId?: string;
    guildName?: string;
    channelId?: string;
    channelName?: string;
    messageId?: string;
    isVoiceChannel?: boolean;
    isDM?: boolean;
}
/** X (Twitter)-specific context. */
export interface XContext {
    tweetId?: string;
    conversationId?: string;
    authorId?: string;
    authorName?: string;
    isReply?: boolean;
    isQuote?: boolean;
    isMention?: boolean;
}
/** YouTube-specific context. */
export interface YoutubeContext {
    videoId?: string;
    channelId?: string;
    commentId?: string;
    liveId?: string;
}
/**
 * Normalized input envelope from any channel.
 *
 * Every channel adapter converts its native event into this shape
 * before handing off to the unified graph.
 */
export interface RequestEnvelope {
    /** Unique ID for this request (UUID v4). */
    requestId: string;
    channel: ShannonChannel;
    sourceUserId: string;
    sourceDisplayName?: string;
    /** Logical conversation ID (persists across multiple messages in a thread). */
    conversationId: string;
    /** Thread ID for checkpointer (channel + conversation scoped). */
    threadId: string;
    text?: string;
    attachments?: RequestAttachment[];
    minecraft?: MinecraftContext;
    discord?: DiscordContext;
    x?: XContext;
    youtube?: YoutubeContext;
    metadata?: Record<string, unknown>;
    tags: string[];
    timestampIso: string;
}
/** A single tool call record within the graph execution. */
export interface ToolCallRecord {
    toolName: string;
    args: Record<string, unknown>;
    result?: unknown;
    error?: string;
    durationMs?: number;
    timestamp: string;
}
/** Planning structure (reuses existing HierarchicalSubTask for detail). */
export interface ShannonPlan {
    goal: string;
    strategy: string;
    steps: HierarchicalSubTask[];
    currentStepId?: string;
    successCriteria?: string[];
    /** Minecraft-specific: next physical actions to execute. */
    nextActions?: ActionItem[];
}
/** Self-modification proposal. */
export interface SelfModProposal {
    targetType: 'prompt' | 'tool' | 'behavior' | 'memory_rule';
    description: string;
    currentValue?: string;
    proposedValue?: string;
    reasoning: string;
    riskLevel: 'low' | 'mid' | 'high';
    approved?: boolean;
}
/** User profile snapshot retrieved at request time. */
export interface UserProfileSnapshot {
    userId: string;
    displayName: string;
    platform: ShannonChannel;
    traits: string[];
    notes: string;
    conversationSummary: string;
    totalInteractions: number;
    relationshipLevel?: 'stranger' | 'acquaintance' | 'friend' | 'close_friend';
}
export interface ShannonSelfImprovementGoal {
    id: string;
    title: string;
    reason: string;
    priority: number;
    status: 'active' | 'paused' | 'done';
}
export interface ShannonSelfObservation {
    timestamp: string;
    observation: string;
    confidence: number;
}
export interface ShannonSelfModel {
    stableIdentity: {
        coreMission: string[];
        behavioralPrinciples: string[];
        toneIdentity: string[];
    };
    capabilities: {
        strengths: string[];
        weaknesses: string[];
        knownFailurePatterns: string[];
    };
    activeImprovementGoals: ShannonSelfImprovementGoal[];
    recentSelfObservations: ShannonSelfObservation[];
}
export interface RelationshipModel {
    userId: string;
    familiarityLevel: number;
    trustLevel: number;
    interactionPreferences: {
        directness: 'low' | 'mid' | 'high';
        warmth: 'low' | 'mid' | 'high';
        structure: 'low' | 'mid' | 'high';
        verbosity: 'short' | 'mid' | 'long';
    };
    recurringTopics: string[];
    activeProjects: string[];
    cautionFlags: string[];
    inferredNeeds: string[];
    updatedAt: string;
}
export interface GoalHierarchy {
    coreConstraints: string[];
    identityGoals: string[];
    longTermGoals: ShannonSelfImprovementGoal[];
    sessionGoal?: {
        title: string;
        successCriteria: string[];
    };
    currentStepGoal?: string;
}
export interface StrategyUpdate {
    id: string;
    basedOnFailure: string;
    triggerConditions: string[];
    newStrategy: string;
    appliesToModes: string[];
    appliesToUsers?: string[];
    confidence: number;
    createdAt: string;
}
export interface InternalState {
    curiosity: number;
    caution: number;
    confidence: number;
    warmth: number;
    focus: number;
    load: number;
    reasonNotes?: string[];
    updatedAt: string;
}
export interface WorldModelPattern {
    id: string;
    domain: 'social' | 'technical' | 'self';
    pattern: string;
    evidenceIds: string[];
    confidence: number;
    applicability: string[];
    updatedAt: string;
}
/**
 * The unified state that flows through the Shannon core graph.
 *
 * Every node reads and writes slices of this state.
 */
export interface ShannonGraphState {
    envelope: RequestEnvelope;
    userProfile?: UserProfileSnapshot;
    selfModel?: ShannonSelfModel;
    relationshipModel?: RelationshipModel;
    goalHierarchy?: GoalHierarchy;
    strategyUpdates?: StrategyUpdate[];
    internalState?: InternalState;
    worldModelPatterns?: WorldModelPattern[];
    conversationSummary?: string;
    recentMessages?: string[];
    mode?: ShannonMode;
    intent?: string;
    riskLevel?: 'low' | 'mid' | 'high';
    needsTools?: boolean;
    needsPlanning?: boolean;
    needsSelfModification?: boolean;
    emotion?: EmotionType;
    relevantMemories: MemoryItem[];
    selfModelPrompt?: string;
    relationshipPrompt?: string;
    strategyPrompt?: string;
    internalStatePrompt?: string;
    worldModelPrompt?: string;
    plan?: ShannonPlan;
    /** Reference to existing Minebot TaskTreeState for backward compat. */
    taskTree?: TaskTreeState;
    toolBudget?: number;
    allowedTools?: string[];
    toolCalls: ToolCallRecord[];
    retrievedFacts: string[];
    fcaSummary?: string;
    actionPlan?: ShannonActionPlan;
    selfModProposal?: SelfModProposal;
    finalAnswer?: string;
    trace: string[];
    warnings: string[];
}
/** Minecraft physical action. */
export type MinecraftAction = {
    type: 'say';
    text: string;
} | {
    type: 'move_to';
    x: number;
    y: number;
    z: number;
} | {
    type: 'follow';
    target: string;
    distance?: number;
} | {
    type: 'mine';
    block: string;
    count?: number;
} | {
    type: 'craft';
    item: string;
    count?: number;
} | {
    type: 'place';
    item: string;
    x: number;
    y: number;
    z: number;
} | {
    type: 'attack';
    target: string;
} | {
    type: 'defend';
    strategy?: string;
} | {
    type: 'observe';
    target?: string;
    radius?: number;
} | {
    type: 'use_skill';
    skillName: string;
    args: Record<string, unknown>;
};
/** X (Twitter) action. */
export type XAction = {
    type: 'reply';
    text: string;
} | {
    type: 'post';
    text: string;
} | {
    type: 'quote';
    text: string;
    targetTweetId: string;
} | {
    type: 'draft';
    text: string;
};
/** Discord action. */
export type DiscordAction = {
    type: 'reply';
    text: string;
} | {
    type: 'react';
    emoji: string;
} | {
    type: 'send_embed';
    title: string;
    body: string;
    color?: number;
} | {
    type: 'voice_speak';
    text: string;
};
/**
 * Channel-specific action plan produced by action_formatter.
 *
 * The message field is the generic text response.
 * Channel-specific arrays contain platform-native actions.
 */
export interface ShannonActionPlan {
    channel: ShannonChannel;
    /** Generic text response (works on any channel). */
    message?: string;
    /** Minecraft physical actions (ordered). */
    minecraftActions?: MinecraftAction[];
    /** X (Twitter) actions. */
    xActions?: XAction[];
    /** Discord actions. */
    discordActions?: DiscordAction[];
}
/** Memory visibility scope determines who can access a memory item. */
export type MemoryVisibilityScope = 'private_user' | 'shared_project' | 'shared_channel' | 'shared_world' | 'global_generalized' | 'self_model';
/** Memory category. */
export type MemoryKind = 'preference' | 'project' | 'relationship' | 'history' | 'creative' | 'task' | 'generalized_knowledge' | 'world_state' | 'self_model';
/**
 * Unified memory item stored in the shared memory store.
 *
 * Replaces the split between ShannonMemory (experience/knowledge)
 * and PersonMemory with a single scoped structure.
 */
export interface MemoryItem {
    id: string;
    kind: MemoryKind;
    /** Human-readable summary of this memory. */
    summary: string;
    /** Optional detailed content. */
    content?: string;
    /** Shannon's feeling/emotion when this was stored. */
    feeling?: string;
    /** User who "owns" this memory (for private_user scope). */
    ownerUserId?: string;
    /** All users involved in creating this memory. */
    sourceUserIds: string[];
    /** Channel where this memory originated. */
    sourceChannel: ShannonChannel;
    visibilityScope: MemoryVisibilityScope;
    worldTags?: string[];
    projectTags?: string[];
    channelTags?: string[];
    relationTags?: string[];
    sensitivityLevel: 'low' | 'mid' | 'high';
    /** Whether this has been distilled into general knowledge. */
    generalized: boolean;
    importance: number;
    relevanceScore?: number;
    embedding?: number[];
    createdAt: string;
    updatedAt?: string;
    sourceRefs?: string[];
}
/** Query structure for memory recall. */
export interface MemoryQuery {
    currentUserId: string;
    channel: ShannonChannel;
    mode?: ShannonMode;
    text: string;
    tags: string[];
    minecraftWorldId?: string;
    projectTags?: string[];
    limit?: number;
}
/** Memory namespace for organizing storage. */
export type MemoryNamespace = `private_user/${string}` | `shared_project/${string}` | `shared_channel/${string}` | `shared_world/${string}` | 'generalized/global' | 'self_model/shannon';
/** An append-only memory write event produced by graph invocations. */
export interface MemoryWriteEvent {
    eventId: string;
    timestamp: string;
    sourceRequestId: string;
    operation: 'create' | 'update_signal' | 'delete_signal';
    item: Partial<MemoryItem> & {
        id: string;
    };
}
/**
 * Input adapter: converts channel-native events into RequestEnvelopes.
 *
 * Adapters are intentionally input-only. Output dispatch is handled
 * by ActionDispatcher, which receives the original envelope alongside
 * the plan so it has full context (channel IDs, user IDs, etc.).
 */
export interface ChannelAdapter<TNativeEvent = unknown> {
    readonly channel: ShannonChannel;
    /** Convert a native channel event into a RequestEnvelope. */
    toEnvelope(event: TNativeEvent): RequestEnvelope;
}
/**
 * Output dispatcher: sends ShannonActionPlans back to the originating channel.
 *
 * Receives the original envelope so it can extract any channel-specific
 * routing info (Discord channelId, X tweetId, etc.) without hacks.
 */
export interface ActionDispatcher {
    readonly channel: ShannonChannel;
    /** Send the action plan back to the channel. */
    dispatch(envelope: RequestEnvelope, plan: ShannonActionPlan): Promise<void>;
}
/**
 * Standard signature for a Shannon graph node.
 *
 * Each node receives the current state and returns a partial update.
 */
export type ShannonNodeFn = (state: ShannonGraphState) => Promise<Partial<ShannonGraphState>>;

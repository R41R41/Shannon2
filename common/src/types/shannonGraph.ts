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

// ---------------------------------------------------------------------------
// 0. Channel & Mode
// ---------------------------------------------------------------------------

/** All interaction surfaces Shannon can operate on. */
export type ShannonChannel =
  | 'discord'
  | 'x'
  | 'minecraft'
  | 'web'
  | 'youtube'
  | 'scheduler'
  | 'notion'
  | 'internal';

/** Execution mode that drives graph routing decisions. */
export type ShannonMode =
  | 'conversational'        // Normal conversation (Discord, Web, etc.)
  | 'task_execution'        // Tool-using task
  | 'planning'              // Complex multi-step planning
  | 'minecraft_action'      // Minecraft physical actions (move, mine, craft)
  | 'minecraft_emergency'   // Minecraft emergency (under attack, death, etc.)
  | 'broadcast'             // Publishing content (X post, auto-tweet, etc.)
  | 'self_reflection'       // Self-evaluation & model update
  | 'voice_conversation';   // Voice channel interaction

// ---------------------------------------------------------------------------
// 1. RequestEnvelope — unified input from all channels
// ---------------------------------------------------------------------------

/** Attachment included with a request. */
export interface RequestAttachment {
  type: 'image' | 'audio' | 'video' | 'file';
  url?: string;
  data?: string;          // base64 for inline data
  mimeType?: string;
  filename?: string;
}

/** Minecraft-specific context snapshot at request time. */
export interface MinecraftContext {
  serverId?: string;
  serverName?: string;
  worldId?: string;
  dimension?: string;     // overworld, nether, end
  biome?: string;
  position?: { x: number; y: number; z: number };
  health?: number;
  food?: number;
  nearbyEntities?: string[];
  inventory?: Array<{ name: string; count: number }>;
  eventType?:
    | 'chat'
    | 'mentioned'
    | 'attacked'
    | 'observed'
    | 'task_result'
    | 'death'
    | 'system';
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

  // -- source identification --
  channel: ShannonChannel;
  sourceUserId: string;
  sourceDisplayName?: string;

  // -- session / thread tracking --
  /** Logical conversation ID (persists across multiple messages in a thread). */
  conversationId: string;
  /** Thread ID for checkpointer (channel + conversation scoped). */
  threadId: string;

  // -- raw input --
  text?: string;
  attachments?: RequestAttachment[];

  // -- channel-specific context --
  minecraft?: MinecraftContext;
  discord?: DiscordContext;
  x?: XContext;
  youtube?: YoutubeContext;

  // -- generic metadata --
  metadata?: Record<string, unknown>;

  // -- tags for recall & routing --
  tags: string[];

  // -- timing --
  timestampIso: string;
}

// ---------------------------------------------------------------------------
// 2. ShannonGraphState — unified state for the core graph
// ---------------------------------------------------------------------------

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

/**
 * The unified state that flows through the Shannon core graph.
 *
 * Every node reads and writes slices of this state.
 */
export interface ShannonGraphState {
  // -- input --
  envelope: RequestEnvelope;

  // -- user & conversation context --
  userProfile?: UserProfileSnapshot;
  conversationSummary?: string;
  recentMessages?: string[];

  // -- classification & routing --
  mode?: ShannonMode;
  intent?: string;
  riskLevel?: 'low' | 'mid' | 'high';
  needsTools?: boolean;
  needsPlanning?: boolean;
  needsSelfModification?: boolean;

  // -- emotion (carried over from existing EmotionNode) --
  emotion?: EmotionType;

  // -- memory recall --
  relevantMemories: MemoryItem[];

  // -- planning --
  plan?: ShannonPlan;
  /** Reference to existing Minebot TaskTreeState for backward compat. */
  taskTree?: TaskTreeState;

  // -- tool execution --
  toolBudget?: number;
  allowedTools?: string[];
  toolCalls: ToolCallRecord[];
  retrievedFacts: string[];

  // -- FCA summary --
  fcaSummary?: string;

  // -- output --
  actionPlan?: ShannonActionPlan;
  selfModProposal?: SelfModProposal;
  finalAnswer?: string;

  // -- observability --
  trace: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// 3. ShannonActionPlan — channel-aware output
// ---------------------------------------------------------------------------

/** Minecraft physical action. */
export type MinecraftAction =
  | { type: 'say'; text: string }
  | { type: 'move_to'; x: number; y: number; z: number }
  | { type: 'follow'; target: string; distance?: number }
  | { type: 'mine'; block: string; count?: number }
  | { type: 'craft'; item: string; count?: number }
  | { type: 'place'; item: string; x: number; y: number; z: number }
  | { type: 'attack'; target: string }
  | { type: 'defend'; strategy?: string }
  | { type: 'observe'; target?: string; radius?: number }
  | { type: 'use_skill'; skillName: string; args: Record<string, unknown> };

/** X (Twitter) action. */
export type XAction =
  | { type: 'reply'; text: string }
  | { type: 'post'; text: string }
  | { type: 'quote'; text: string; targetTweetId: string }
  | { type: 'draft'; text: string };

/** Discord action. */
export type DiscordAction =
  | { type: 'reply'; text: string }
  | { type: 'react'; emoji: string }
  | { type: 'send_embed'; title: string; body: string; color?: number }
  | { type: 'voice_speak'; text: string };

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

// ---------------------------------------------------------------------------
// 4. MemoryItem — scoped shared memory
// ---------------------------------------------------------------------------

/** Memory visibility scope determines who can access a memory item. */
export type MemoryVisibilityScope =
  | 'private_user'            // Only the owning user
  | 'shared_project'          // Project collaborators
  | 'shared_channel'          // Same channel space
  | 'shared_world'            // Same Minecraft world
  | 'global_generalized'      // Anyone (distilled knowledge)
  | 'self_model';             // Shannon's self-knowledge

/** Memory category. */
export type MemoryKind =
  | 'preference'              // User preference
  | 'project'                 // Project-related fact
  | 'relationship'            // Interpersonal knowledge
  | 'history'                 // Past interaction or event
  | 'creative'                // Creative work or idea
  | 'task'                    // Ongoing or completed task
  | 'generalized_knowledge'   // Distilled general knowledge
  | 'world_state'             // Minecraft world state
  | 'self_model';             // Shannon's self-knowledge

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

  // -- ownership & source --
  /** User who "owns" this memory (for private_user scope). */
  ownerUserId?: string;
  /** All users involved in creating this memory. */
  sourceUserIds: string[];
  /** Channel where this memory originated. */
  sourceChannel: ShannonChannel;

  // -- scoping --
  visibilityScope: MemoryVisibilityScope;

  // -- tags (used for recall filtering) --
  worldTags?: string[];       // e.g. ["survival_main", "overworld"]
  projectTags?: string[];     // e.g. ["website_redesign"]
  channelTags?: string[];     // e.g. ["discord", "friend_server"]
  relationTags?: string[];    // e.g. ["rai", "close_friend"]

  // -- sensitivity & generalization --
  sensitivityLevel: 'low' | 'mid' | 'high';
  /** Whether this has been distilled into general knowledge. */
  generalized: boolean;

  // -- scoring --
  importance: number;         // 1-10, compatible with existing ShannonMemory
  relevanceScore?: number;    // Computed at recall time

  // -- embedding --
  embedding?: number[];

  // -- timestamps --
  createdAt: string;
  updatedAt?: string;

  // -- provenance --
  sourceRefs?: string[];      // IDs of source memories / conversations
}

// ---------------------------------------------------------------------------
// 5. Memory Query & Recall
// ---------------------------------------------------------------------------

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
export type MemoryNamespace =
  | `private_user/${string}`
  | `shared_project/${string}`
  | `shared_channel/${string}`
  | `shared_world/${string}`
  | 'generalized/global'
  | 'self_model/shannon';

// ---------------------------------------------------------------------------
// 6. Memory Write Event (append-only)
// ---------------------------------------------------------------------------

/** An append-only memory write event produced by graph invocations. */
export interface MemoryWriteEvent {
  eventId: string;
  timestamp: string;
  sourceRequestId: string;     // Links back to the RequestEnvelope
  operation: 'create' | 'update_signal' | 'delete_signal';
  item: Partial<MemoryItem> & { id: string };
}

// ---------------------------------------------------------------------------
// 7. Adapter & Dispatcher contracts
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 8. Graph node signature
// ---------------------------------------------------------------------------

/**
 * Standard signature for a Shannon graph node.
 *
 * Each node receives the current state and returns a partial update.
 */
export type ShannonNodeFn = (
  state: ShannonGraphState,
) => Promise<Partial<ShannonGraphState>>;

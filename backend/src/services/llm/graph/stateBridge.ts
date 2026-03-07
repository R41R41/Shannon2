/**
 * State Bridge
 *
 * Bidirectional conversion between the legacy TaskStateInput / TaskContext
 * and the new ShannonGraphState / RequestEnvelope.
 *
 * This allows the unified graph to delegate to existing nodes
 * (EmotionNode, MemoryNode, FunctionCallingAgent) during the migration
 * period, and lets existing callers invoke the unified graph without
 * rewriting all call-sites at once.
 */

import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import {
  TaskContext,
  Platform,
  MemoryZone,
  EmotionType,
} from '@shannon/common';
import type {
  RequestEnvelope,
  ShannonGraphState,
  ShannonChannel,
  ShannonMode,
} from '@shannon/common';
import type { TaskStateInput } from './types.js';

// ---------------------------------------------------------------------------
// Channel ↔ Platform mapping
// ---------------------------------------------------------------------------

const channelToPlatform: Record<ShannonChannel, Platform> = {
  discord: 'discord',
  x: 'twitter',
  minecraft: 'minebot',
  web: 'web',
  youtube: 'youtube',
  scheduler: 'web',
  notion: 'notion',
  internal: 'web',
};

const platformToChannel: Partial<Record<Platform, ShannonChannel>> = {
  discord: 'discord',
  twitter: 'x',
  minebot: 'minecraft',
  minecraft: 'minecraft',
  web: 'web',
  youtube: 'youtube',
  notion: 'internal',
};

// ---------------------------------------------------------------------------
// ShannonGraphState → TaskStateInput (for calling existing nodes)
// ---------------------------------------------------------------------------

/**
 * Extract a legacy TaskContext from a RequestEnvelope.
 */
export function envelopeToTaskContext(envelope: RequestEnvelope): TaskContext {
  const platform = channelToPlatform[envelope.channel] ?? 'web';

  const ctx: TaskContext = { platform };

  if (envelope.discord) {
    ctx.discord = {
      guildId: envelope.discord.guildId,
      guildName: envelope.discord.guildName,
      channelId: envelope.discord.channelId,
      channelName: envelope.discord.channelName,
      messageId: envelope.discord.messageId,
    };
  }

  if (envelope.x) {
    ctx.twitter = {
      tweetId: envelope.x.tweetId,
      authorId: envelope.x.authorId,
      authorName: envelope.x.authorName,
    };
  }

  if (envelope.youtube) {
    ctx.youtube = {
      videoId: envelope.youtube.videoId,
      channelId: envelope.youtube.channelId,
      commentId: envelope.youtube.commentId,
      liveId: envelope.youtube.liveId,
    };
  }

  ctx.conversationId = envelope.conversationId;
  return ctx;
}

/**
 * Derive a legacy MemoryZone from a RequestEnvelope.
 */
export function envelopeToMemoryZone(envelope: RequestEnvelope): MemoryZone {
  // Check metadata for explicitly stored legacy zone
  const legacy = envelope.metadata?.legacyMemoryZone as string | undefined;

  switch (envelope.channel) {
    case 'discord':
      return `discord:${legacy ?? envelope.discord?.guildName ?? 'unknown'}` as MemoryZone;
    case 'x':
      return 'twitter:post' as MemoryZone;
    case 'minecraft':
      return 'minebot' as MemoryZone;
    case 'web':
      return 'web' as MemoryZone;
    case 'youtube':
      return 'youtube' as MemoryZone;
    default:
      return 'web' as MemoryZone;
  }
}

/**
 * Convert unified graph state to a legacy TaskStateInput
 * so that existing nodes can be called without modification.
 */
export function toTaskStateInput(
  state: ShannonGraphState,
  messages?: BaseMessage[],
): TaskStateInput {
  const envelope = state.envelope;

  return {
    context: envelopeToTaskContext(envelope),
    memoryZone: envelopeToMemoryZone(envelope),
    channelId: envelope.discord?.channelId ?? envelope.conversationId,
    userMessage: envelope.text ?? null,
    messages: messages ?? [],
    emotion: state.emotion ?? null,
    environmentState: (envelope.metadata?.environmentState as string) ?? null,
    selfState: (envelope.metadata?.selfState as string) ?? null,
    isEmergency: envelope.tags.includes('emergency'),
    taskTree: state.taskTree ?? null,
  };
}

// ---------------------------------------------------------------------------
// TaskStateInput → ShannonGraphState (for entry from legacy callers)
// ---------------------------------------------------------------------------

/**
 * Build a minimal RequestEnvelope from legacy TaskStateInput.
 *
 * Used when the existing LLMService.processMessage() needs to
 * invoke the unified graph instead of the legacy TaskGraph.
 */
export function taskInputToEnvelope(input: TaskStateInput): RequestEnvelope {
  const platform = input.context?.platform ?? 'web';
  const channel: ShannonChannel = platformToChannel[platform] ?? 'web';

  const tags: string[] = [channel];
  if (input.isEmergency) tags.push('emergency');

  return {
    requestId: input.taskId ?? crypto.randomUUID(),
    channel,
    sourceUserId: input.context?.discord?.userId ?? 'unknown',
    sourceDisplayName: input.context?.discord?.userName,
    conversationId: input.context?.conversationId ?? input.channelId ?? channel,
    threadId: input.channelId ?? channel,
    text: input.userMessage ?? undefined,
    discord: input.context?.discord
      ? {
          guildId: input.context.discord.guildId,
          guildName: input.context.discord.guildName,
          channelId: input.context.discord.channelId,
          channelName: input.context.discord.channelName,
          messageId: input.context.discord.messageId,
        }
      : undefined,
    x: input.context?.twitter
      ? {
          tweetId: input.context.twitter.tweetId,
          authorId: input.context.twitter.authorId,
          authorName: input.context.twitter.authorName,
        }
      : undefined,
    youtube: input.context?.youtube
      ? {
          videoId: input.context.youtube.videoId,
          channelId: input.context.youtube.channelId,
          commentId: input.context.youtube.commentId,
          liveId: input.context.youtube.liveId,
        }
      : undefined,
    metadata: {
      environmentState: input.environmentState,
      selfState: input.selfState,
      legacyMemoryZone: input.memoryZone,
    },
    tags,
    timestampIso: new Date().toISOString(),
  };
}

/**
 * Create an initial ShannonGraphState from legacy TaskStateInput.
 */
export function taskInputToGraphState(input: TaskStateInput): ShannonGraphState {
  return {
    envelope: taskInputToEnvelope(input),
    emotion: input.emotion ?? undefined,
    taskTree: input.taskTree ?? undefined,
    relevantMemories: [],
    toolCalls: [],
    retrievedFacts: [],
    trace: ['stateBridge:taskInputToGraphState'],
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Mode inference
// ---------------------------------------------------------------------------

/**
 * Infer the initial ShannonMode from a RequestEnvelope.
 * A more sophisticated classifier node will refine this later.
 */
export function inferInitialMode(envelope: RequestEnvelope): ShannonMode {
  if (envelope.channel === 'minecraft') {
    if (envelope.tags.includes('emergency') || envelope.minecraft?.eventType === 'death') {
      return 'minecraft_emergency';
    }
    if (envelope.minecraft?.eventType === 'attacked') {
      return 'minecraft_emergency';
    }
    return 'minecraft_action';
  }

  if (envelope.channel === 'x') {
    return 'broadcast';
  }

  if (envelope.tags.includes('voice_channel')) {
    return 'voice_conversation';
  }

  return 'conversational';
}

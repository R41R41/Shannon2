/**
 * State Bridge
 *
 * Conversion between legacy TaskStateInput / TaskContext
 * and the unified RequestEnvelope.
 *
 * Remaining functions:
 * - envelopeToTaskContext: for nodes that still need TaskContext (EmotionNode, FCA)
 * - envelopeToMemoryZone: for legacy compatibility
 * - taskInputToEnvelope: for LLMService.processMessage() entry point
 * - inferInitialMode: for ingest node
 */

import {
  TaskContext,
  Platform,
  MemoryZone,
} from '@shannon/common';
import type {
  RequestEnvelope,
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

/**
 * Extract a legacy TaskContext from a RequestEnvelope.
 * Used by EmotionNode and FCA which still accept TaskContext.
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
 * Build a RequestEnvelope from legacy TaskStateInput.
 * Used by LLMService.processMessage() as the entry point.
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

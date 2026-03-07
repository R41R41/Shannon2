/**
 * Discord Channel Adapter
 *
 * Converts Discord-native events (DiscordSendTextMessageOutput)
 * into RequestEnvelopes and dispatches ShannonActionPlans back to Discord.
 */

import {
  RequestEnvelope,
  ShannonActionPlan,
  ChannelAdapter,
} from '@shannon/common';
import { createEnvelope } from './envelopeFactory.js';

/**
 * Shape of the data currently published by Discord client
 * via eventBus as 'llm:get_discord_message'.
 * Mirrors DiscordSendTextMessageOutput in discord/client.ts.
 */
export interface DiscordNativeEvent {
  text: string;
  type: string;
  guildName: string;
  channelId: string;
  guildId: string;
  channelName: string;
  userName: string;
  messageId: string;
  userId: string;
  recentMessages?: unknown[];
  isVoiceChannel?: boolean;
  isDM?: boolean;
}

/**
 * Callback type for sending messages back to Discord.
 * The actual implementation lives in DiscordBot and is injected at runtime.
 */
export type DiscordDispatchFn = (
  channelId: string,
  plan: ShannonActionPlan,
) => Promise<void>;

export class DiscordAdapter implements ChannelAdapter<DiscordNativeEvent> {
  readonly channel = 'discord' as const;

  constructor(private dispatchFn?: DiscordDispatchFn) {}

  /** Set the dispatch function (can be injected after construction). */
  setDispatch(fn: DiscordDispatchFn): void {
    this.dispatchFn = fn;
  }

  toEnvelope(event: DiscordNativeEvent): RequestEnvelope {
    // Build tags from server/channel context
    const tags: string[] = [];
    if (event.guildName) tags.push(event.guildName);
    if (event.channelName) tags.push(event.channelName);
    if (event.isVoiceChannel) tags.push('voice_channel');
    if (event.isDM) tags.push('dm');

    return createEnvelope({
      channel: 'discord',
      sourceUserId: event.userId,
      sourceDisplayName: event.userName,
      conversationId: `discord:${event.guildId}:${event.channelId}`,
      threadId: `discord:${event.channelId}`,
      text: event.text,
      tags,
      discord: {
        guildId: event.guildId,
        guildName: event.guildName,
        channelId: event.channelId,
        channelName: event.channelName,
        messageId: event.messageId,
        isVoiceChannel: event.isVoiceChannel,
        isDM: event.isDM,
      },
      metadata: {
        recentMessages: event.recentMessages,
        legacyMemoryZone: event.guildName,
      },
    });
  }

  async dispatch(plan: ShannonActionPlan): Promise<void> {
    if (!this.dispatchFn) {
      throw new Error('DiscordAdapter: dispatchFn not set');
    }

    // Extract channelId from the plan's metadata or the original envelope
    // For now, callers must provide channelId via a wrapper
    const channelId = (plan as any)._channelId;
    if (!channelId) {
      throw new Error('DiscordAdapter: missing _channelId on plan');
    }

    await this.dispatchFn(channelId, plan);
  }
}

/**
 * Discord Action Dispatcher
 *
 * Sends ShannonActionPlans back to Discord channels.
 * Complements the FCA tool-based dispatch (chat-on-discord)
 * with a structured action plan dispatch path.
 */

import type {
  RequestEnvelope,
  ShannonActionPlan,
  ActionDispatcher,
  DiscordAction,
} from '@shannon/common';
import { getEventBus } from '../../../events/eventBus.js';
import { logger } from '../../../utils/logger.js';

export const discordDispatcher: ActionDispatcher = {
  channel: 'discord',

  async dispatch(envelope: RequestEnvelope, plan: ShannonActionPlan): Promise<void> {
    const eventBus = getEventBus();
    const channelId = envelope.discord?.channelId;
    const guildId = envelope.discord?.guildId;

    if (!channelId) {
      logger.warn('[DiscordDispatcher] No channelId in envelope, cannot dispatch');
      return;
    }

    // Process each Discord action
    const actions = plan.discordActions ?? [];
    for (const action of actions) {
      await dispatchAction(eventBus, envelope, action);
    }

    // Fallback: if no explicit actions but has a message, send as reply
    if (actions.length === 0 && plan.message) {
      eventBus.publish({
        type: 'discord:send_message',
        memoryZone: `discord:${envelope.discord?.guildName ?? 'unknown'}`,
        data: {
          channelId,
          guildId,
          text: plan.message,
          replyToMessageId: envelope.discord?.messageId,
        },
      });
    }
  },
};

async function dispatchAction(
  eventBus: ReturnType<typeof getEventBus>,
  envelope: RequestEnvelope,
  action: DiscordAction,
): Promise<void> {
  const channelId = envelope.discord?.channelId;
  const guildId = envelope.discord?.guildId;
  const memoryZone = `discord:${envelope.discord?.guildName ?? 'unknown'}`;

  switch (action.type) {
    case 'reply':
      eventBus.publish({
        type: 'discord:send_message',
        memoryZone,
        data: {
          channelId,
          guildId,
          text: action.text,
          replyToMessageId: envelope.discord?.messageId,
        },
      });
      break;

    case 'react':
      eventBus.publish({
        type: 'discord:react',
        memoryZone,
        data: {
          channelId,
          messageId: envelope.discord?.messageId,
          emoji: action.emoji,
        },
      });
      break;

    case 'send_embed':
      eventBus.publish({
        type: 'discord:send_embed',
        memoryZone,
        data: {
          channelId,
          guildId,
          title: action.title,
          body: action.body,
          color: action.color,
        },
      });
      break;

    case 'voice_speak':
      eventBus.publish({
        type: 'discord:voice_speak',
        memoryZone,
        data: {
          guildId,
          channelId,
          text: action.text,
        },
      });
      break;
  }
}

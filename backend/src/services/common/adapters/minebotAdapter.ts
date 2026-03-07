/**
 * Minebot Channel Adapter
 *
 * Converts Minecraft bot events (chat, attacks, observations)
 * into RequestEnvelopes and dispatches ShannonActionPlans
 * as Minecraft actions (say, move, mine, craft, etc.).
 */

import {
  RequestEnvelope,
  ShannonActionPlan,
  ChannelAdapter,
  MinecraftContext,
} from '@shannon/common';
import { createEnvelope } from './envelopeFactory.js';

/**
 * Shape of a minebot chat/event input.
 * Derived from the current SkillAgent.processMessage() parameters
 * and the bot's environmentState / selfState.
 */
export interface MinebotNativeEvent {
  // Who sent the message
  senderName: string;
  senderId?: string;
  message: string;

  // Environment state (parsed from bot.environmentState)
  serverName?: string;
  senderPosition?: { x: number; y: number; z: number };
  weather?: string;
  time?: string;
  biome?: string;
  dimension?: string;
  bossbar?: string;

  // Self state (parsed from bot.selfState)
  botPosition?: { x: number; y: number; z: number };
  botHealth?: number;
  botFoodLevel?: number;
  botHeldItem?: string;
  lookingAt?: string;
  inventory?: Array<{ name: string; count: number }>;

  // Nearby entities
  nearbyEntities?: string[];

  // Event classification
  eventType?: 'chat' | 'mentioned' | 'attacked' | 'observed' | 'task_result' | 'death' | 'system';

  // Emergency flag
  isEmergency?: boolean;
}

/** Callback for executing Minecraft actions. */
export type MinebotDispatchFn = (plan: ShannonActionPlan) => Promise<void>;

export class MinebotAdapter implements ChannelAdapter<MinebotNativeEvent> {
  readonly channel = 'minecraft' as const;

  constructor(private dispatchFn?: MinebotDispatchFn) {}

  setDispatch(fn: MinebotDispatchFn): void {
    this.dispatchFn = fn;
  }

  toEnvelope(event: MinebotNativeEvent): RequestEnvelope {
    const tags: string[] = [];
    if (event.serverName) tags.push(event.serverName);
    if (event.dimension) tags.push(event.dimension);
    if (event.biome) tags.push(event.biome);
    if (event.isEmergency) tags.push('emergency');
    if (event.eventType) tags.push(event.eventType);

    const minecraft: MinecraftContext = {
      serverName: event.serverName,
      dimension: event.dimension,
      biome: event.biome,
      position: event.botPosition,
      health: event.botHealth,
      food: event.botFoodLevel,
      nearbyEntities: event.nearbyEntities,
      inventory: event.inventory,
      eventType: event.eventType ?? 'chat',
    };

    return createEnvelope({
      channel: 'minecraft',
      sourceUserId: event.senderId ?? event.senderName,
      sourceDisplayName: event.senderName,
      conversationId: `minecraft:${event.serverName ?? 'default'}:${event.senderName}`,
      threadId: `minecraft:${event.serverName ?? 'default'}`,
      text: event.message,
      tags,
      minecraft,
      metadata: {
        // Preserve raw state strings for backward compat with existing nodes
        environmentState: JSON.stringify({
          senderName: event.senderName,
          senderPosition: event.senderPosition,
          weather: event.weather,
          time: event.time,
          biome: event.biome,
          dimension: event.dimension,
          bossbar: event.bossbar,
        }),
        selfState: JSON.stringify({
          botPosition: event.botPosition,
          botHealth: event.botHealth,
          botFoodLevel: event.botFoodLevel,
          botHeldItem: event.botHeldItem,
          lookingAt: event.lookingAt,
          inventory: event.inventory,
        }),
        isEmergency: event.isEmergency ?? false,
        legacyMemoryZone: 'minebot',
      },
    });
  }

  async dispatch(plan: ShannonActionPlan): Promise<void> {
    if (!this.dispatchFn) {
      throw new Error('MinebotAdapter: dispatchFn not set');
    }
    await this.dispatchFn(plan);
  }
}

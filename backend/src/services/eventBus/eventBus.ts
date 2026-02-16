import {
  Color,
  Event,
  EventType,
  ILog,
  MemoryZone,
  TypedEvent,
} from '@shannon/common';
import Log from '../../models/Log.js';
import { logger } from '../../utils/logger.js';

export class EventBus {
  // Internal storage uses the broad Event callback type for runtime flexibility.
  private listeners: Map<string, Array<(event: unknown) => void>> = new Map();

  /**
   * Type-safe subscribe: callback receives a TypedEvent whose `data`
   * is automatically narrowed based on the event type string.
   *
   * @example
   * eventBus.subscribe('discord:post_message', (event) => {
   *   // event.data is DiscordSendTextMessageInput (no cast needed)
   *   console.log(event.data.channelId);
   * });
   */
  subscribe<T extends EventType>(
    eventType: T,
    callback: (event: TypedEvent<T>) => void
  ): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    // Cast needed: internal storage uses `unknown` while external API is generic
    const wrappedCallback = callback as (event: unknown) => void;
    this.listeners.get(eventType)?.push(wrappedCallback);

    return () => {
      const callbacks = this.listeners.get(eventType);
      if (callbacks) {
        this.listeners.set(
          eventType,
          callbacks.filter((cb) => cb !== wrappedCallback)
        );
      }
    };
  }

  /**
   * Type-safe publish: ensures the event data matches the expected
   * payload type for the given event type.
   *
   * @example
   * eventBus.publish({
   *   type: 'discord:planning',
   *   memoryZone: 'discord:aiminelab_server',
   *   data: { planning, channelId, taskId }, // type-checked as DiscordPlanningInput
   * });
   */
  publish<T extends EventType>(event: TypedEvent<T>): void {
    this.listeners.get(event.type)?.forEach((callback) => {
      if (
        !event.targetMemoryZones ||
        event.targetMemoryZones.includes(event.memoryZone)
      ) {
        callback(event);
      }
    });
  }

  /**
   * ログを保存する
   * @param memoryZone メモリゾーン
   * @param color 色
   * @param content 内容
   * @param isSave 保存するかどうか
   */
  public async log(
    memoryZone: MemoryZone,
    color: Color,
    content: string,
    isSave: boolean = false
  ) {
    const logEntry: ILog = {
      timestamp: new Date(),
      memoryZone,
      color,
      content,
    };
    logger.info(content, color);

    if (isSave) {
      try {
        await Log.create(logEntry);
        const logCount = await Log.countDocuments();
        if (logCount > 10000) {
          const logsToDelete = logCount - 5000;
          const oldestLogs = await Log.find()
            .sort({ timestamp: 1 })
            .limit(logsToDelete);

          if (oldestLogs.length > 0) {
            await Log.deleteMany({
              _id: { $in: oldestLogs.map((log) => log._id) },
            });
            logger.info(`${logsToDelete}件の古いログを削除しました`);
          }
        }
      } catch (error) {
        logger.error('Error saving log', error);
      }
    }

    this.publish({
      type: 'web:log',
      memoryZone: 'web',
      data: logEntry,
      targetMemoryZones: ['web'],
    });
  }
}

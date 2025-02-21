import { Color, Event, EventType, ILog, MemoryZone } from '@shannon/common';
import Log from '../../models/Log.js';

export class EventBus {
  private listeners: Map<EventType, Array<(event: Event) => void>> = new Map();

  /**
   * イベントタイプに対応するコールバック関数を追加する
   * @param eventType イベントタイプ
   * @param callback コールバック関数
   */
  subscribe(
    eventType: EventType,
    callback: (event: Event) => void
  ): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType)?.push(callback);

    // unsubscribe関数を返す
    return () => {
      const callbacks = this.listeners.get(eventType);
      if (callbacks) {
        this.listeners.set(
          eventType,
          callbacks.filter((cb) => cb !== callback)
        );
      }
    };
  }

  /**
   * イベントを送信する
   * @param event イベント
   */
  publish(event: Event) {
    this.listeners.get(event.type)?.forEach((callback) => {
      // targetMemoryZonesが指定されている場合、対象メモリゾーンのみに配信
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
    if (color === 'green') {
      console.log(`\x1b[32m${content}\x1b[0m`);
    } else if (color === 'red') {
      console.error(`\x1b[31m${content}\x1b[0m`);
    } else if (color === 'yellow') {
      console.log(`\x1b[33m${content}\x1b[0m`);
    } else if (color === 'blue') {
      console.log(`\x1b[34m${content}\x1b[0m`);
    } else if (color === 'magenta') {
      console.log(`\x1b[35m${content}\x1b[0m`);
    } else if (color === 'cyan') {
      console.log(`\x1b[36m${content}\x1b[0m`);
    } else {
      console.log(content);
    }

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
            console.log(`${logsToDelete}件の古いログを削除しました`);
          }
        }
      } catch (error) {
        console.error('Error saving log:', error);
      }
    }

    this.publish({
      type: 'web:log',
      memoryZone: 'web',
      data: logEntry,
      targetMemoryZones: ['web'],
    } as Event);
  }
}

import Log, { ILog } from '../models/Log.js';
import {
  DiscordMessageInput,
  DiscordMessageOutput,
  EventType,
  MemoryZone,
  MinecraftInput,
  MinecraftOutput,
  TwitterMessageInput,
  TwitterMessageOutput,
  WebMessageInput,
  WebMessageOutput,
} from '../types/index.js';

export interface Event {
  type: EventType;
  memoryZone: MemoryZone;
  data:
    | TwitterMessageInput
    | WebMessageInput
    | DiscordMessageInput
    | ILog
    | TwitterMessageOutput
    | WebMessageOutput
    | DiscordMessageOutput
    | MinecraftInput
    | MinecraftOutput;
  targetMemoryZones?: MemoryZone[];
}

export type Color =
  | 'white'
  | 'red'
  | 'green'
  | 'blue'
  | 'yellow'
  | 'magenta'
  | 'cyan';

export interface LogEntry {
  timestamp: string;
  memoryZone: string;
  color: Color;
  content: string;
}

export class EventBus {
  private listeners: Map<EventType, Array<(event: Event) => void>> = new Map();

  /**
   * イベントタイプに対応するコールバック関数を追加する
   * @param eventType イベントタイプ
   * @param callback コールバック関数
   */
  subscribe(eventType: EventType, callback: (event: Event) => void) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType)?.push(callback);
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
      type: 'log',
      memoryZone: 'web',
      data: logEntry,
    });
  }
}

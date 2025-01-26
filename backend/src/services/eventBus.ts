import { Platform } from './llm/types/index.js';
import { ILog } from '../models/Log.js';
import Log from '../models/Log.js';

export type EventType =
  | 'llm:response'
  | 'twitter:post'
  | 'youtube:stats'
  | 'discord:message'
  | 'minecraft:message'
  | 'web:message'
  | 'log';

export interface Event {
  type: EventType;
  platform: Platform;
  data: any;
  targetPlatforms?: Platform[]; // 送信先プラットフォーム
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
  platform: string;
  color: Color;
  content: string;
}

export interface DiscordMessage {
  content: string;
  type: 'text' | 'voice';
  channelId: string;
  userName: string;
}

export class EventBus {
  private listeners: Map<EventType, Array<(event: Event) => void>> = new Map();

  subscribe(eventType: EventType, callback: (event: Event) => void) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType)?.push(callback);
  }

  publish(event: Event) {
    this.listeners.get(event.type)?.forEach((callback) => {
      // targetPlatformsが指定されている場合、対象プラットフォームのみに配信
      if (
        !event.targetPlatforms ||
        event.targetPlatforms.includes(event.platform)
      ) {
        callback(event);
      }
    });
  }

  public async log(platform: Platform, color: Color, content: string) {
    const logEntry: ILog = {
      timestamp: new Date(),
      platform,
      color,
      content,
    };

    try {
      await Log.create(logEntry);
      console.log('Log saved to database');
    } catch (error) {
      console.error('Error saving log:', error);
    }

    this.publish({
      type: 'log',
      platform: 'web',
      data: logEntry,
    });
  }
}

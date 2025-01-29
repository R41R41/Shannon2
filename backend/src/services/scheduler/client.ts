import cron from 'node-cron';
import { TwitterMessageInput } from '../../types/types.js';
import { EventBus } from '../eventBus.js';

export class Scheduler {
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  public async start() {
    await this.scheduleCreatePost();
  }

  private async scheduleCreatePost() {
    cron.schedule('0 8 * * *', () => {
      this.eventBus.publish({
        type: 'twitter:post_scheduled_message',
        memoryZone: 'twitter:post',
        data: {
          platform: 'twitter',
          type: 'fortune',
        } as TwitterMessageInput,
        targetMemoryZones: ['twitter:schedule_post'],
      });
    });

    cron.schedule('0 12 * * *', () => {
      this.eventBus.publish({
        type: 'twitter:post_scheduled_message',
        memoryZone: 'twitter:post',
        data: {
          platform: 'twitter',
          type: 'about_today',
        } as TwitterMessageInput,
        targetMemoryZones: ['twitter:schedule_post'],
      });
    });

    cron.schedule('0 18 * * *', () => {
      this.eventBus.publish({
        type: 'twitter:post_scheduled_message',
        memoryZone: 'twitter:post',
        data: {
          platform: 'twitter',
          type: 'weather',
        } as TwitterMessageInput,
        targetMemoryZones: ['twitter:schedule_post'],
      });
    });
  }
}

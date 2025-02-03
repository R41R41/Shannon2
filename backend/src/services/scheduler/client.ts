import {
  Schedule,
  SchedulerInput,
  SchedulerOutput,
  TwitterMessageInput,
} from '@shannon/common';
import fs from 'fs';
import cron from 'node-cron';
import { EventBus } from '../eventBus.js';

export class Scheduler {
  private eventBus: EventBus;
  private schedules: Schedule[];

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.schedules = [];
  }

  private async setUpSchedule() {
    this.schedules = JSON.parse(
      fs.readFileSync('saves/schedule.json', 'utf8')
    ) as Schedule[];
  }

  public async start() {
    await this.setUpSchedule();
    await this.setupEventBus();
    await this.scheduleCreatePost();
  }

  private async setupEventBus() {
    this.eventBus.subscribe('scheduler:get_schedule', (event) => {
      this.post_schedule(event.data as SchedulerInput);
    });
    this.eventBus.subscribe('scheduler:call_schedule', (event) => {
      this.call_schedule(event.data as SchedulerInput);
    });
  }

  private async post_schedule(data: SchedulerInput) {
    this.eventBus.publish({
      type: 'web:post_schedule',
      memoryZone: 'web',
      data: {
        type: 'post_schedule',
        data: this.schedules,
      } as SchedulerOutput,
      targetMemoryZones: ['web'],
    });
  }

  private async call_schedule(data: SchedulerInput) {
    const platform = data.name?.split(':')[0];
    const name = data.name?.split(':')[1];
    console.log('calling schedule', platform, name);
    if (platform && name) {
      if (platform === 'twitter') {
        this.eventBus.publish({
          type: `llm:post_scheduled_message`,
          memoryZone: `twitter:schedule_post`,
          data: {
            command: name,
          } as TwitterMessageInput,
          targetMemoryZones: [`twitter:schedule_post`],
        });
      }
    }
  }

  private async scheduleCreatePost() {
    this.schedules.forEach((schedule) => {
      cron.schedule(schedule.time, () => {
        this.eventBus.publish(schedule.data);
      });
    });
  }
}

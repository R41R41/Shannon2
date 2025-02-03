import {
  Schedule,
  SchedulerInput,
  SchedulerOutput,
  TwitterMessageInput,
} from '@shannon/common';
import fs from 'fs';
import cron from 'node-cron';
import { BaseClient } from '../common/BaseClient.js';
import { EventBus } from '../eventBus.js';

export class Scheduler extends BaseClient {
  private static instance: Scheduler;
  private schedules: Schedule[];
  public isTest: boolean = false;

  public static getInstance(eventBus: EventBus, isTest: boolean = false) {
    if (!Scheduler.instance) {
      Scheduler.instance = new Scheduler('scheduler', eventBus, isTest);
    }
    Scheduler.instance.isTest = isTest;
    return Scheduler.instance;
  }

  constructor(
    serviceName: 'scheduler',
    eventBus: EventBus,
    isTest: boolean = false
  ) {
    super(serviceName, eventBus);
    this.schedules = [];
  }

  public async initialize() {
    await this.setUpSchedule();
    await this.setupEventBus();
    await this.scheduleCreatePost();
  }

  private async setUpSchedule() {
    this.schedules = JSON.parse(
      fs.readFileSync('saves/schedule.json', 'utf8')
    ) as Schedule[];
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

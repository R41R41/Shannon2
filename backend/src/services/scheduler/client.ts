import fs from 'fs';
import cron from 'node-cron';
import { Schedule } from '../../types/types.js';
import { EventBus } from '../eventBus.js';

export class Scheduler {
  private eventBus: EventBus;
  private schedule: Schedule[];

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.schedule = [];
  }

  private async setUpSchedule() {
    this.schedule = JSON.parse(
      fs.readFileSync('saves/schedule.json', 'utf8')
    ) as Schedule[];
  }

  public async start() {
    await this.setUpSchedule();
    await this.scheduleCreatePost();
  }

  private async scheduleCreatePost() {
    this.schedule.forEach((schedule) => {
      cron.schedule(schedule.time, () => {
        this.eventBus.publish(schedule.data);
      });
    });
  }
}

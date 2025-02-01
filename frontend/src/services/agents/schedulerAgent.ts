import { isWebScheduleOutput } from '@common/checkTypes';
import { WebSocketClientBase } from '../common/WebSocketClient';
import { Schedule } from '@common/types';
import { URLS } from '../config/ports';

type UpdateScheduleCallback = (schedule: Schedule[]) => void;

type SearchCallback = (results: Schedule[]) => void;

export class SchedulerAgent extends WebSocketClientBase {
  private static instance: SchedulerAgent;

  public static getInstance() {
    if (!SchedulerAgent.instance) {
      SchedulerAgent.instance = new SchedulerAgent(URLS.WEBSOCKET.SCHEDULER);
    }
    return SchedulerAgent.instance;
  }

  private searchListeners: Set<SearchCallback> = new Set();

  public updateScheduleCallback: UpdateScheduleCallback;

  private constructor(url: string) {
    super(url);
    this.updateScheduleCallback = () => {};
  }

  protected handleMessage(message: string) {
    const data = JSON.parse(message);
    if (!isWebScheduleOutput(data)) {
      console.error('Invalid message', data);
      return;
    }
    if (data.type === 'pong') return;
    if (data.type === 'post_schedule') {
      this.searchListeners.forEach((listener) =>
        listener(data.data as Schedule[])
      );
    }
  }

  public setUpdateScheduleCallback(callback: UpdateScheduleCallback) {
    this.updateScheduleCallback = callback;
  }

  public async getSchedules(): Promise<void> {
    this.send(JSON.stringify({ type: 'get_schedule' }));
  }

  public async executeSchedule(name: string): Promise<void> {
    this.send(JSON.stringify({ type: 'execute_schedule', name }));
  }

  public onSearchResults(callback: SearchCallback) {
    this.searchListeners.add(callback);
    return () => this.searchListeners.delete(callback);
  }

  public async getAllSchedules(): Promise<Schedule[]> {
    return new Promise((resolve) => {
      const handleAllSchedules = (schedules: Schedule[]) => {
        this.searchListeners.delete(handleAllSchedules);
        resolve(schedules);
      };

      this.searchListeners.add(handleAllSchedules);

      this.send(JSON.stringify({ type: 'get_schedule' }));
    });
  }
}

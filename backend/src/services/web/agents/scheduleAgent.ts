import { isWebScheduleInput } from '@common/checkTypes';
import {
  SchedulerInput,
  SchedulerOutput,
  WebScheduleOutput,
} from '@common/types';
import {
  WebSocketServiceBase,
  WebSocketServiceConfig,
} from '../../common/WebSocketService.js';

export class ScheduleAgent extends WebSocketServiceBase {
  public constructor(config: WebSocketServiceConfig) {
    super(config);
  }

  protected override initialize() {
    this.wss.on('connection', async (ws) => {
      console.log('\x1b[34mSchedule client connected\x1b[0m');

      ws.on('message', async (message) => {
        const data = JSON.parse(message.toString());

        if (isWebScheduleInput(data)) {
          if (data.type === 'ping') {
            this.broadcast({ type: 'pong' } as WebScheduleOutput);
            return;
          }
          console.log(
            `\x1b[34mvalid web message received: ${JSON.stringify(data)}\x1b[0m`
          );
        } else {
          console.error('Invalid message format:', data);
          return;
        }
        if (data.type === 'get_schedule') {
          const scheduleName = data.scheduleName as string;
          this.eventBus.publish({
            type: 'web:get_schedule',
            memoryZone: 'web',
            data: { type: 'get_schedule', scheduleName } as SchedulerInput,
          });
        }
      });

      ws.on('close', () => {
        console.log('\x1b[31mMonitoring Client disconnected\x1b[0m');
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    });

    this.eventBus.subscribe('web:post_schedule', (event) => {
      const data = event.data as SchedulerOutput;
      if (data.type === 'post_schedule') {
        this.broadcast({
          type: 'post_schedule',
          data: data.data,
        } as WebScheduleOutput);
      }
    });
  }

  public start() {
    super.start();
  }
}

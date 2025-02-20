import { TaskTreeState } from '@shannon/common';
import {
  WebSocketServiceBase,
  WebSocketServiceConfig,
} from '../../common/WebSocketService.js';

export class PlanningAgent extends WebSocketServiceBase {
  private static instance: PlanningAgent;
  private constructor(config: WebSocketServiceConfig) {
    super(config);
  }

  public static getInstance(config: WebSocketServiceConfig): PlanningAgent {
    if (!PlanningAgent.instance) {
      PlanningAgent.instance = new PlanningAgent(config);
    }
    return PlanningAgent.instance;
  }
  protected override initialize() {
    this.wss.on('connection', async (ws) => {
      console.log('\x1b[34mPlanning client connected\x1b[0m');

      ws.on('message', async (message) => {
        const data = JSON.parse(message.toString());

        if (data.type === 'ping') {
          this.broadcast({ type: 'pong' });
          return;
        }
      });

      ws.on('close', () => {
        console.log('\x1b[31mPlanning Client disconnected\x1b[0m');
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    });

    console.log('\x1b[31mplanningAgent subscribe\x1b[0m');

    this.eventBus.subscribe('web:planning', (event) => {
      const data = event.data as TaskTreeState;
      this.broadcast({
        type: 'web:planning',
        data: data,
      });
    });
  }

  public start() {
    super.start();
  }
}

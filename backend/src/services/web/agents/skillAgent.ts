import {
  WebSocketServiceBase,
  WebSocketServiceConfig,
} from '../../common/WebSocketService.js';
import { SkillInfo } from '@shannon/common';

export class SkillAgent extends WebSocketServiceBase {
  private static instance: SkillAgent;
  private constructor(config: WebSocketServiceConfig) {
    super(config);
  }

  public static getInstance(config: WebSocketServiceConfig): SkillAgent {
    if (!SkillAgent.instance) {
      SkillAgent.instance = new SkillAgent(config);
    }
    return SkillAgent.instance;
  }
  protected override initialize() {
    this.wss.on('connection', async (ws) => {
      console.log('\x1b[34mSkill client connected\x1b[0m');

      ws.on('message', async (message) => {
        const data = JSON.parse(message.toString());

        if (data.type === 'ping') {
          this.broadcast({ type: 'pong' });
          return;
        }

        if (data.type === 'get_skills') {
          this.eventBus.publish({
            type: 'llm:get_skills',
            memoryZone: 'web',
            data: { type: 'get_skills' },
          });
        }
      });

      ws.on('close', () => {
        console.log('\x1b[31mSkill Client disconnected\x1b[0m');
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    });

    console.log('\x1b[31mSkillAgent subscribe\x1b[0m');

    this.eventBus.subscribe('web:skill', (event) => {
      const data = event.data as SkillInfo[];
      this.broadcast({
        type: 'web:skill',
        data: data,
      });
    });
  }

  public start() {
    super.start();
  }
}

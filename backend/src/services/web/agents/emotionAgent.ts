import { EmotionType } from '@shannon/common';
import {
  WebSocketServiceBase,
  WebSocketServiceConfig,
} from '../../common/WebSocketService.js';

export class EmotionAgent extends WebSocketServiceBase {
  private static instance: EmotionAgent;
  public constructor(config: WebSocketServiceConfig) {
    super(config);
  }

  public static getInstance(config: WebSocketServiceConfig) {
    if (!EmotionAgent.instance) {
      EmotionAgent.instance = new EmotionAgent(config);
    }
    return EmotionAgent.instance;
  }
  protected override initialize() {
    this.wss.on('connection', async (ws) => {
      console.log('\x1b[34mEmotion client connected\x1b[0m');

      ws.on('message', async (message) => {
        const data = JSON.parse(message.toString());

        if (data.type === 'ping') {
          this.broadcast({ type: 'pong' });
          return;
        }
      });

      ws.on('close', () => {
        console.log('\x1b[31mEmotion Client disconnected\x1b[0m');
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    });

    console.log('\x1b[31mEmotionAgent subscribe\x1b[0m');

    this.eventBus.subscribe('web:emotion', (event) => {
      console.log('web:emotion', event);
      const data = event.data as EmotionType;
      this.broadcast({
        type: 'web:emotion',
        data: data,
      });
    });
  }

  public start() {
    super.start();
  }
}

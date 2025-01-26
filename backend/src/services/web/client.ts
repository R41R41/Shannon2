import { WebSocketServer, WebSocket } from 'ws';
import { EventBus } from '../../services/eventBus.js';
import { LLMMessage } from '../../services/llm/types/index.js';
import express from 'express';
import http from 'http';
import cors from 'cors';
import { PORTS } from '../../config/ports.js';

export class WebClient {
  private wss: WebSocketServer;
  private eventBus: EventBus;
  private client: WebSocket | null = null;
  private app: express.Application;
  private server: http.Server;
  private initialized: boolean = false;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    this.initialized = false;

    this.setupExpress();
    this.setupWebSocket();
    // this.setupEventHandlers();
  }

  private setupExpress() {
    this.app.use(
      cors({
        origin: `http://localhost:${PORTS.FRONTEND}`,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        allowedHeaders: ['Content-Type'],
        credentials: true,
      })
    );
    this.app.use(express.json());
  }

  private setupWebSocket() {
    if (this.initialized) return;
    this.initialized = true;
    this.wss.on('connection', (ws) => {
      this.client = ws;
      console.log('\x1b[32mClient connected\x1b[0m');

      ws.on('message', async (message) => {
        try {
          const parsedMessage = JSON.parse(message.toString());

          // テキストメッセージの処理
          if (parsedMessage.type === 'text') {
            const llmMessage: LLMMessage = {
              platform: 'web',
              type: 'realtime_text',
              content: parsedMessage.content,
              context: {
                sessionId: parsedMessage.sessionId,
              },
            };

            this.eventBus.publish({
              type: 'web:message',
              platform: 'web',
              data: llmMessage,
            });
          } else if (parsedMessage.type === 'voice_append') {
            const llmMessage: LLMMessage = {
              platform: 'web',
              type: 'realtime_voice_append',
              content: parsedMessage.content,
              context: {
                sessionId: parsedMessage.sessionId,
              },
            };

            this.eventBus.publish({
              type: 'web:message',
              platform: 'web',
              data: llmMessage,
            });
          } else if (parsedMessage.type === 'voice_commit') {
            const llmMessage: LLMMessage = {
              platform: 'web',
              type: 'realtime_voice_commit',
              content: parsedMessage.content,
              context: {
                sessionId: parsedMessage.sessionId,
              },
            };

            this.eventBus.publish({
              type: 'web:message',
              platform: 'web',
              data: llmMessage,
            });
          } else if (parsedMessage.type === 'vad_change') {
            const llmMessage: LLMMessage = {
              platform: 'web',
              type: 'realtime_vad_change',
              content: parsedMessage.content,
              context: {
                sessionId: parsedMessage.sessionId,
              },
            };

            this.eventBus.publish({
              type: 'web:message',
              platform: 'web',
              data: llmMessage,
            });
          }
        } catch (error) {
          console.error('Error processing message:', error);
        }
      });

      ws.on('close', () => {
        this.client = null;
        console.log('\x1b[31mClient disconnected\x1b[0m');
      });

      this.eventBus.subscribe('llm:response', (event) => {
        if (event.platform === 'web') {
          const { content, type, context } = event.data;

          ws.send(
            JSON.stringify({
              type: type,
              content: content,
              sessionId: context.sessionId,
            })
          );
        }
      });
    });
  }

  private setupEventHandlers() {
    // LLMからの応答を処理
    this.eventBus.subscribe('llm:response', (event) => {
      if (event.platform === 'web') {
        const { content, type, context } = event.data;

        // 該当するクライアントにメッセージを送信
        if (this.client && this.client.readyState === WebSocket.OPEN) {
          console.log('\x1b[32mSending response to client\x1b[0m:', content);
          this.client.send(
            JSON.stringify({
              type: type,
              content: content,
              sessionId: context.sessionId,
            })
          );
        }
      }
    });
  }

  public async start() {
    this.server.listen(PORTS.WEBSOCKET.WEB, () => {
      console.log(
        `\x1b[32mWeb WebSocket Server is running on port ${PORTS.WEBSOCKET.WEB}\x1b[0m`
      );
    });
  }

  public async shutdown() {
    if (this.client) {
      this.client.close();
    }
    this.server.close();
  }
}

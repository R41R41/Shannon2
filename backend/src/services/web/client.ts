import { WebSocketServer, WebSocket } from 'ws';
import { EventBus } from '@/services/llm/eventBus';
import { LLMMessage } from '@/services/llm/types';
import express from 'express';
import http from 'http';
import cors from 'cors';
import { PORTS } from '@/config/ports';

export class WebClient {
  private wss: WebSocketServer;
  private eventBus: EventBus;
  private clients: Set<WebSocket> = new Set();
  private app: express.Application;
  private server: http.Server;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    
    this.setupExpress();
    this.setupWebSocket();
    this.setupEventHandlers();
  }

  private setupExpress() {
    this.app.use(cors({
      origin: `http://localhost:${PORTS.FRONTEND}`,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      allowedHeaders: ['Content-Type'],
      credentials: true,
    }));
    this.app.use(express.json());
  }

  private setupWebSocket() {
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      console.log('Client connected');

      ws.on('message', async (message) => {
        try {
          const parsedMessage = JSON.parse(message.toString());
          
          // テキストメッセージの処理
          if (parsedMessage.type === 'text') {
            const llmMessage: LLMMessage = {
              platform: 'web',
              type: 'text',
              content: parsedMessage.content,
              context: {
                sessionId: parsedMessage.sessionId
              }
            };

            this.eventBus.publish({
              type: 'web:message',
              platform: 'web',
              data: llmMessage
            });
          }
          
          // 音声メッセージの処理
          else if (parsedMessage.type === 'voice') {
            const llmMessage: LLMMessage = {
              platform: 'web',
              type: 'voice',
              content: parsedMessage.content,
              context: {
                sessionId: parsedMessage.sessionId
              }
            };

            this.eventBus.publish({
              type: 'web:message',
              platform: 'web',
              data: llmMessage
            });
          }
        } catch (error) {
          console.error('Error processing message:', error);
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log('Client disconnected');
      });
    });
  }

  private setupEventHandlers() {
    // LLMからの応答を処理
    this.eventBus.subscribe('llm:response', (event) => {
      if (event.platform === 'web') {
        const { content, type, context } = event.data;
        
        // 該当するクライアントにメッセージを送信
        this.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: type === 'voice' ? 'audio' : 'text',
              content: content,
              sessionId: context.sessionId
            }));
          }
        });
      }
    });
  }

  public async start() {
    this.server.listen(PORTS.WEBSOCKET.WEB, () => {
      console.log(`Web WebSocket Server is running on port ${PORTS.WEBSOCKET.WEB}`);
    });
  }

  public async shutdown() {
    this.clients.forEach(client => {
      client.close();
    });
    this.server.close();
  }
}

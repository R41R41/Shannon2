import cors from 'cors';
import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { PORTS } from '../../config/ports.js';
import { EventBus } from '../../services/eventBus.js';
import { WebMessageInput, WebMessageOutput } from '../../types/index.js';

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
      console.log('\x1b[32mWeb Client connected\x1b[0m');

      ws.on('message', async (message) => {
        try {
          const parsedMessage = JSON.parse(message.toString());

          if (parsedMessage.type === 'realtime_text') {
            this.eventBus.log('web', 'white', parsedMessage.realtime_text);
            const message: WebMessageInput = {
              type: 'realtime_text',
              realtime_text: parsedMessage.realtime_text,
            };

            this.eventBus.publish({
              type: 'web:get_message',
              memoryZone: 'web',
              data: message,
            });
          } else if (parsedMessage.type === 'text') {
            this.eventBus.log('web', 'white', parsedMessage.text, true);
            const message: WebMessageInput = {
              type: 'text',
              text: parsedMessage.text,
            };
            this.eventBus.publish({
              type: 'web:get_message',
              memoryZone: 'web',
              data: message,
            });
          } else if (parsedMessage.type === 'voice_append') {
            const message: WebMessageInput = {
              type: 'realtime_audio',
              realtime_audio: parsedMessage.realtime_audio,
            };

            this.eventBus.publish({
              type: 'web:get_message',
              memoryZone: 'web',
              data: message,
            });
          } else if (parsedMessage.type === 'voice_commit') {
            this.eventBus.log(
              'web',
              'white',
              'received realtime voice commit',
              true
            );
            const message: WebMessageInput = {
              type: 'endpoint',
              endpoint: 'audio_done',
            };

            this.eventBus.publish({
              type: 'web:get_message',
              memoryZone: 'web',
              data: message,
            });
          } else if (parsedMessage.type === 'vad_change') {
            this.eventBus.log('web', 'white', 'received realtime vad change');
            const message: WebMessageInput = {
              type: 'endpoint',
              endpoint: parsedMessage.endpoint,
            };

            this.eventBus.publish({
              type: 'web:get_message',
              memoryZone: 'web',
              data: message,
            });
          }
        } catch (error) {
          this.eventBus.log(
            'web',
            'red',
            'Error processing message:' + error,
            true
          );
          console.error('Error processing message:', error);
        }
      });

      ws.on('close', () => {
        this.client = null;
        this.eventBus.log('web', 'red', 'Client disconnected');
        console.log('\x1b[31mClient disconnected\x1b[0m');
      });

      this.eventBus.subscribe('web:post_message', (event) => {
        if (event.memoryZone === 'web') {
          const { type, text, audio, endpoint } =
            event.data as WebMessageOutput;
          ws.send(
            JSON.stringify({
              type: type,
              text: text,
              audio: audio,
              endpoint: endpoint,
            })
          );
        }
      });
    });
  }

  public async start() {
    this.server.listen(PORTS.WEBSOCKET.WEB, () => {
      this.eventBus.log('web', 'blue', 'Web WebSocket Server is running');
      console.log(
        `\x1b[34mWeb WebSocket Server is running on port ${PORTS.WEBSOCKET.WEB}\x1b[0m`
      );
    });
  }

  public async shutdown() {
    if (this.client) {
      this.client.close();
    }
    this.server.close();
    this.eventBus.log('web', 'red', 'Web WebSocket Server is shutdown', true);
    console.log('\x1b[31mWeb WebSocket Server is shutdown\x1b[0m');
  }
}

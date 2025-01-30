import cors from 'cors';
import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { PORTS } from '../../config/ports.js';
import { EventBus } from '../../services/eventBus.js';
import { isWebMessageInput } from '../../types/checkTypes.js';
import { WebMessageInput } from '../../types/types.js';
import { MonitoringAgent } from './agents/monitoringAgent.js';

export class WebClient {
  private wss: WebSocketServer;
  private eventBus: EventBus;
  private client: WebSocket | null = null;
  private app: express.Application;
  private server: http.Server;
  private initialized: boolean = false;
  private monitoringAgent: MonitoringAgent;
  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    this.initialized = false;
    this.setupExpress();
    this.setupWebSocket();
    this.monitoringAgent = new MonitoringAgent(this.eventBus);
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
          const data = JSON.parse(message.toString());
          if (isWebMessageInput(data)) {
            console.log(
              `\x1b[34mvalid web message received: ${
                data.type === 'realtime_audio'
                  ? data.type + ' ' + data.realtime_audio?.length
                  : data.type === 'audio'
                  ? data.type + ' ' + data.audio?.length
                  : JSON.stringify(data)
              }\x1b[0m`
            );
          } else {
            throw new Error('Invalid message format');
          }

          if (data.type === 'realtime_text' && data.realtime_text) {
            this.eventBus.log('web', 'white', data.realtime_text);
            const message: WebMessageInput = {
              type: 'realtime_text',
              realtime_text: data.realtime_text,
            };

            this.eventBus.publish({
              type: 'web:get_message',
              memoryZone: 'web',
              data: message,
            });
          } else if (data.type === 'text' && data.text) {
            this.eventBus.log('web', 'white', data.text, true);
            const message: WebMessageInput = {
              type: 'text',
              text: data.text,
            };
            this.eventBus.publish({
              type: 'web:get_message',
              memoryZone: 'web',
              data: message,
            });
          } else if (data.type === 'realtime_audio' && data.realtime_audio) {
            const message: WebMessageInput = {
              type: 'realtime_audio',
              realtime_audio: data.realtime_audio,
              endpoint: 'realtime_audio_append',
            };

            this.eventBus.publish({
              type: 'web:get_message',
              memoryZone: 'web',
              data: message,
            });
          } else if (
            data.type === 'realtime_audio' &&
            data.endpoint === 'realtime_audio_commit'
          ) {
            const message: WebMessageInput = {
              type: 'realtime_audio',
              endpoint: 'realtime_audio_commit',
            };

            this.eventBus.publish({
              type: 'web:get_message',
              memoryZone: 'web',
              data: message,
            });
          } else if (data.type === 'endpoint' && data.endpoint) {
            this.eventBus.log(
              'web',
              'white',
              'received realtime voice commit',
              true
            );
            const message: WebMessageInput = {
              type: 'endpoint',
              endpoint: data.endpoint,
            };

            this.eventBus.publish({
              type: 'web:get_message',
              memoryZone: 'web',
              data: message,
            });
          } else if (data.endpoint === 'realtime_vad_on') {
            this.eventBus.log('web', 'white', 'received realtime vad on');
            const message: WebMessageInput = {
              type: 'endpoint',
              endpoint: data.endpoint,
            };

            this.eventBus.publish({
              type: 'web:get_message',
              memoryZone: 'web',
              data: message,
            });
          } else if (data.endpoint === 'realtime_vad_off') {
            this.eventBus.log('web', 'white', 'received realtime vad off');
            const message: WebMessageInput = {
              type: 'endpoint',
              endpoint: data.endpoint,
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
          ws.send(JSON.stringify(event.data));
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

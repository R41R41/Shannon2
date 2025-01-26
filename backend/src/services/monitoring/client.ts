import { WebSocketServer, WebSocket } from 'ws';
import { EventBus, LogEntry } from '../eventBus';
import { PORTS } from '../../config/ports.js';

export class MonitoringService {
  private wss: WebSocketServer;
  private client: WebSocket | null = null;
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.wss = new WebSocketServer({
      port: PORTS.WEBSOCKET.MONITORING as number,
    });
    this.setupWebSocket();
    this.setupEventHandlers();
  }

  private setupWebSocket() {
    this.wss.on('connection', (ws) => {
      this.client = ws;
      console.log('Monitoring client connected');

      ws.on('close', () => {
        this.client = null;
        console.log('Monitoring client disconnected');
      });
    });
  }

  private setupEventHandlers() {
    this.eventBus.subscribe('log', (event) => {
      if (this.client && this.client.readyState === WebSocket.OPEN) {
        this.client.send(JSON.stringify(event.data));
      }
    });
  }

  public async initialize() {
    this.eventBus.log('web', 'blue', 'Monitoring Client initialized');
  }
}

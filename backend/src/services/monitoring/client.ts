import { WebSocketServer, WebSocket } from 'ws';
import { EventBus } from '../eventBus.js';
import { PORTS } from '../../config/ports.js';
import Log from '../../models/Log.js';

interface SearchQuery {
  startDate?: string;
  endDate?: string;
  platform?: string;
  content?: string;
}

export class MonitoringService {
  private wss: WebSocketServer;
  private eventBus: EventBus;
  private client: WebSocket | null = null;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.wss = new WebSocketServer({
      port: PORTS.WEBSOCKET.MONITORING as number,
    });
    this.setupEventHandlers();
  }

  private async setupEventHandlers() {
    // WebSocket接続時の処理
    this.wss.on('connection', async (ws) => {
      console.log('Monitoring client connected');

      // 既存の接続がある場合は切断
      if (this.client) {
        this.client.close();
      }

      this.client = ws;

      // 最新200件のログを取得して送信
      const logs = await Log.find()
        .sort({ timestamp: -1 })
        .limit(200)
        .sort({ timestamp: 1 });

      logs.forEach((log) => {
        if (this.client?.readyState === WebSocket.OPEN) {
          this.client.send(JSON.stringify({ type: 'log', data: log }));
        }
      });

      // 検索リクエストのハンドリング
      ws.on('message', async (message) => {
        const data = JSON.parse(message.toString());
        if (data.type === 'search') {
          const query = data.query as SearchQuery;
          const searchResults = await this.searchLogs(query);
          if (this.client?.readyState === WebSocket.OPEN) {
            this.client.send(
              JSON.stringify({
                type: 'searchResults',
                data: searchResults,
              })
            );
          }
        }
      });

      ws.on('close', () => {
        this.client = null;
        console.log('\x1b[31mMonitoring Client disconnected\x1b[0m');
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        if (this.client === ws) {
          this.client = null;
        }
      });
    });

    // イベントバスからのログ購読
    this.eventBus.subscribe('log', (event) => {
      if (this.client && this.client.readyState === WebSocket.OPEN) {
        this.client.send(JSON.stringify({ type: 'log', data: event.data }));
      }
    });
  }

  private async searchLogs(query: SearchQuery) {
    const filter: any = {};

    if (query.startDate && query.endDate) {
      filter.timestamp = {
        $gte: query.startDate,
        $lte: query.endDate,
      };
    }

    if (query.platform) {
      filter.platform = query.platform;
    }

    if (query.content) {
      filter.content = { $regex: query.content, $options: 'i' };
    }

    return await Log.find(filter)
      .sort({ timestamp: -1 })
      .limit(200)
      .sort({ timestamp: 1 });
  }

  public async initialize() {
    this.eventBus.log('web', 'blue', 'Monitoring Client initialized');
  }
}

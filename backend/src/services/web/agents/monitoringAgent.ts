import { WebSocket, WebSocketServer } from 'ws';
import { PORTS } from '../../../config/ports.js';
import Log from '../../../models/Log.js';
import { ILog, MemoryZone, WebMonitoringOutput } from '../../../types/types.js';
import { EventBus } from '../../eventBus.js';
interface SearchQuery {
  startDate?: string;
  endDate?: string;
  memoryZone?: MemoryZone;
  content?: string;
}

export class MonitoringAgent {
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
      console.log('\x1b[34mMonitoring client connected\x1b[0m');

      // 既存の接続がある場合は切断
      if (this.client) {
        this.client.close();
      }

      this.client = ws;

      // 最新200件のログを取得して送信
      const logs = await Log.find().sort({ timestamp: -1 }).limit(200);
      const sortedLogs = logs.sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
      );

      sortedLogs.forEach((log) => {
        if (this.client?.readyState === WebSocket.OPEN) {
          this.client.send(JSON.stringify({ type: 'web:log', ...log }));
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
                type: 'web:searchResults',
                data: searchResults as ILog[],
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
    this.eventBus.subscribe('web:log', (event) => {
      if (this.client && this.client.readyState === WebSocket.OPEN) {
        const log = event.data as ILog;
        const logOutput: WebMonitoringOutput = {
          type: 'web:log',
          data: log,
        };
        this.client.send(JSON.stringify(logOutput));
      }
    });
  }

  private async searchLogs(query: SearchQuery) {
    const filter: any = {};

    if (query.startDate && query.endDate) {
      filter.timestamp = {
        $gte: new Date(query.startDate),
        $lte: new Date(query.endDate),
      };
    }

    if (query.memoryZone) {
      filter.memoryZone = query.memoryZone as MemoryZone;
    }

    if (query.content) {
      filter.content = { $regex: query.content, $options: 'i' };
    }

    return await Log.find(filter).sort({ timestamp: -1 }).limit(200).lean();
  }

  public async initialize() {
    this.eventBus.log('web', 'blue', 'Monitoring Client initialized');
  }
}

import { ILog, MemoryZone, WebMonitoringOutput } from '@shannon/common';
import Log from '../../../models/Log.js';
import {
  WebSocketServiceBase,
  WebSocketServiceConfig,
} from '../../common/WebSocketService.js';
import { EventBus } from '../../eventBus/eventBus.js';
import { getEventBus } from '../../eventBus/index.js';

interface SearchQuery {
  startDate?: string;
  endDate?: string;
  memoryZone?: MemoryZone;
  content?: string;
}

export class MonitoringAgent extends WebSocketServiceBase {
  private static instance: MonitoringAgent;
  private eventBus: EventBus;
  private messageSubscription: (() => void) | null = null;

  private constructor(config: WebSocketServiceConfig) {
    super(config);
    this.eventBus = getEventBus();

    this.messageSubscription = this.eventBus.subscribe('web:log', (event) => {
      this.broadcast({
        type: 'web:log',
        data: event.data as ILog,
      } as WebMonitoringOutput);
    });
  }

  public static getInstance(config: WebSocketServiceConfig): MonitoringAgent {
    if (!MonitoringAgent.instance) {
      MonitoringAgent.instance = new MonitoringAgent(config);
    }
    return MonitoringAgent.instance;
  }

  protected override initialize() {
    this.wss.on('connection', async (ws) => {
      console.log('\x1b[34mMonitoring client connected\x1b[0m');

      this.handleNewConnection(ws);

      ws.on('close', () => {
        console.log('\x1b[31mMonitoring client disconnected\x1b[0m');
      });

      const logs = await Log.find().sort({ timestamp: -1 }).limit(200);
      const sortedLogs = logs.sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
      );

      sortedLogs.forEach((log) => {
        this.broadcast({ type: 'web:log', data: log } as WebMonitoringOutput);
      });

      // 検索リクエストのハンドリング
      ws.on('message', async (message) => {
        const data = JSON.parse(message.toString());

        if (data.type === 'ping') {
          this.broadcast({ type: 'pong' } as WebMonitoringOutput);
          return;
        }
        console.log(
          `\x1b[34mvalid web message received in monitoring agent: ${
            data.type === 'search'
              ? JSON.stringify(data.query)
              : JSON.stringify(data)
          }\x1b[0m`
        );
        if (data.type === 'search') {
          const query = data.query as SearchQuery;
          const searchResults = await this.searchLogs(query);
          this.broadcast({
            type: 'web:searchResults',
            data: searchResults as ILog[],
          } as WebMonitoringOutput);
        }
      });

      ws.on('close', () => {
        console.log('\x1b[31mMonitoring Client disconnected\x1b[0m');
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
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

  public start() {
    super.start();
  }

  public disconnect() {
    if (this.messageSubscription) {
      this.messageSubscription();
      this.messageSubscription = null;
    }
  }
}

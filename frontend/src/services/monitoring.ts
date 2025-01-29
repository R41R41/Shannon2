import { WS_MONITORING_URL } from './apiTypes';
import { ILog, WebMonitoringOutput } from '@/types/types';

export interface SearchQuery {
  startDate?: string;
  endDate?: string;
  platform?: string;
  content?: string;
}

type LogCallback = (log: ILog) => void;
type SearchCallback = (results: ILog[]) => void;

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';

export class MonitoringService {
  private static instance: MonitoringService;
  private ws: WebSocket | null = null;
  private listeners: Set<LogCallback> = new Set();
  private searchListeners: Set<SearchCallback> = new Set();
  private reconnectDelay: number = 3000;
  private webStatusListeners: Set<(status: ConnectionStatus) => void> =
    new Set();
  private webStatus: ConnectionStatus = 'disconnected';
  private pingInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.initialize();
  }

  public static getInstance(): MonitoringService {
    if (!MonitoringService.instance) {
      MonitoringService.instance = new MonitoringService();
    }
    return MonitoringService.instance;
  }

  private initialize() {
    this.connect();
  }

  private connect() {
    this.setStatus('connecting');
    this.ws = new WebSocket(`${WS_MONITORING_URL}`);

    this.ws.onmessage = (event) => {
      const { type, ...data } = JSON.parse(event.data) as WebMonitoringOutput;

      if (type === 'web:log') {
        this.listeners.forEach((listener) => {
          if (data.data) {
            listener(data.data as ILog);
          }
        });
      } else if (type === 'web:searchResults') {
        this.searchListeners.forEach((listener) => {
          listener(data.data as ILog[]);
        });
      }
    };

    this.ws.onclose = () => {
      console.log('Monitoring WebSocket closed');
      this.stopPing();
      this.setStatus('disconnected');
      this.setWebStatus('disconnected');
      setTimeout(() => this.connect(), this.reconnectDelay);
    };

    this.ws.onerror = (error) => {
      console.error('Monitoring WebSocket error:', error);
    };

    this.ws.onopen = () => {
      console.log('Monitoring WebSocket connected');
      this.setStatus('connected');

      // 接続確認用のping送信を開始
      this.startPing();
    };
  }

  private startPing() {
    // 既存のpingIntervalをクリア
    this.stopPing();

    // 30秒ごとにping messageを送信
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      } else {
        this.stopPing();
        this.setStatus('disconnected');
      }
    }, 30000);
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  public subscribe(callback: LogCallback) {
    this.listeners.add(callback);
  }

  public unsubscribe(callback: LogCallback) {
    this.listeners.delete(callback);
  }

  public async searchLogs(query: SearchQuery) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'search',
          query,
        })
      );
    }
  }

  public onSearchResults(callback: SearchCallback) {
    this.searchListeners.add(callback);
    return () => this.searchListeners.delete(callback);
  }

  public onWebStatusChange(callback: (status: ConnectionStatus) => void) {
    this.webStatusListeners.add(callback);
    callback(this.webStatus);
    return () => this.webStatusListeners.delete(callback);
  }

  private setWebStatus(status: ConnectionStatus) {
    this.webStatus = status;
    this.webStatusListeners.forEach((listener) => listener(status));
  }

  private setStatus(status: ConnectionStatus) {
    this.webStatus = status;
    this.webStatusListeners.forEach((listener) => listener(status));
  }
}

export default MonitoringService.getInstance;

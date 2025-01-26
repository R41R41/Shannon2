import { WS_MONITORING_URL } from './apiTypes';

export type Color =
  | 'white'
  | 'red'
  | 'green'
  | 'blue'
  | 'yellow'
  | 'magenta'
  | 'cyan';

export interface LogEntry {
  timestamp: string;
  platform: string;
  color: Color;
  content: string;
}

export interface SearchQuery {
  startDate?: string;
  endDate?: string;
  platform?: string;
  content?: string;
}

type LogCallback = (log: LogEntry) => void;
type SearchCallback = (results: LogEntry[]) => void;

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
      const { type, data } = JSON.parse(event.data);

      if (type === 'log') {
        this.listeners.forEach((listener) => {
          listener(data);
        });
      } else if (type === 'searchResults') {
        this.searchListeners.forEach((listener) => {
          listener(data);
        });
      } else if (type === 'webStatus') {
        this.handleWebStatus(data);
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

  private handleWebStatus(status: ConnectionStatus) {
    this.setWebStatus(status);
  }

  private setStatus(status: ConnectionStatus) {
    this.webStatus = status;
    this.webStatusListeners.forEach((listener) => listener(status));
  }
}

export default MonitoringService.getInstance;

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

export class MonitoringService {
  private static instance: MonitoringService;
  private ws: WebSocket | null = null;
  private listeners: Set<LogCallback> = new Set();
  private searchListeners: Set<SearchCallback> = new Set();
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 3000;

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
      }
    };

    this.ws.onclose = () => {
      console.log('Monitoring WebSocket closed');
      this.reconnect();
    };

    this.ws.onerror = (error) => {
      console.error('Monitoring WebSocket error:', error);
    };

    this.ws.onopen = () => {
      console.log('Monitoring WebSocket connected');
      this.reconnectAttempts = 0; // 接続成功時にリセット
    };
  }

  private reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(
      `Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
    );

    setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
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
}

export default MonitoringService.getInstance;

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

type LogCallback = (log: LogEntry) => void;

export class MonitoringService {
  private static instance: MonitoringService;
  private ws: WebSocket | null = null;
  private listeners: Set<LogCallback> = new Set();

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
    this.ws = new WebSocket(`${WS_MONITORING_URL}`);

    this.ws.onmessage = (event) => {
      const log = JSON.parse(event.data);
      this.listeners.forEach((listener) => listener(log));
    };
  }

  public subscribe(callback: LogCallback) {
    this.listeners.add(callback);
  }

  public unsubscribe(callback: LogCallback) {
    this.listeners.delete(callback);
  }
}

export default MonitoringService.getInstance;

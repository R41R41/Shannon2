import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { EventBus } from '../eventBus/eventBus.js';

export interface WebSocketServiceConfig {
  port?: number;
  server?: http.Server;
  eventBus: EventBus;
  serviceName: string;
}

export abstract class WebSocketServiceBase {
  protected wss: WebSocketServer;
  protected eventBus: EventBus;
  protected serviceName: string;
  private isInitialized = false;

  constructor(config: WebSocketServiceConfig) {
    if (config.server) {
      this.wss = new WebSocketServer({ server: config.server });
    } else if (config.port) {
      this.wss = new WebSocketServer({ port: config.port });
    } else {
      throw new Error('Invalid configuration');
    }
    console.log(
      `WebSocketServer created on port ${config.port} for service ${config.serviceName}`
    );
    this.eventBus = config.eventBus;
    this.serviceName = config.serviceName;
  }

  public start() {
    if (!this.isInitialized) {
      this.initialize();
      this.isInitialized = true;
    }
  }

  public broadcast(data: unknown) {
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  }

  protected abstract initialize(): void;
}

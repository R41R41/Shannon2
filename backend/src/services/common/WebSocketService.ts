import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';

export interface WebSocketServiceConfig {
  port?: number;
  server?: http.Server;
  serviceName: string;
}

export abstract class WebSocketServiceBase {
  protected wss: WebSocketServer;
  protected serviceName: string;
  private isInitialized = false;
  protected activeConnections = new Set<WebSocket>();

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
    this.serviceName = config.serviceName;
  }

  public start() {
    if (!this.isInitialized) {
      this.initialize();
      this.isInitialized = true;
    }
  }

  protected handleNewConnection(ws: WebSocket) {
    // 既存の接続を切断
    this.activeConnections.forEach((connection) => {
      try {
        connection.close();
      } catch (error) {
        console.error(`Error closing connection: ${error}`);
      }
    });
    this.activeConnections.clear();

    // 新しい接続を追加
    this.activeConnections.add(ws);

    ws.on('close', () => {
      this.activeConnections.delete(ws);
    });
  }

  public broadcast(data: unknown) {
    this.activeConnections.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  }

  protected abstract initialize(): void;
}

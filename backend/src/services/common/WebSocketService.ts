import { exec } from 'child_process';
import http from 'http';
import { promisify } from 'util';
import WebSocket, { WebSocketServer } from 'ws';
import { logger } from '../../utils/logger.js';

const execAsync = promisify(exec);

export interface WebSocketServiceConfig {
  port?: number;
  server?: http.Server;
  serviceName: string;
}

export abstract class WebSocketServiceBase {
  protected wss!: WebSocketServer;
  protected serviceName: string;
  private isInitialized = false;
  protected activeConnections = new Set<WebSocket>();

  constructor(config: WebSocketServiceConfig) {
    this.serviceName = config.serviceName;
    if (config.server) {
      this.wss = new WebSocketServer({ server: config.server });
      logger.info(`WebSocketServer created with existing server for service ${this.serviceName}`);
    } else if (config.port) {
      this.wss = new WebSocketServer({ port: config.port });
      logger.info(`WebSocketServer created on port ${config.port} for service ${this.serviceName}`);
    } else {
      throw new Error('Invalid configuration');
    }

    // エラーハンドリングを追加
    this.wss.on('error', (error) => {
      logger.error(`WebSocket server error for ${this.serviceName}:`, error);
    });
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
        logger.error(`Error closing connection: ${error}`);
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

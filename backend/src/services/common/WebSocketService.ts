import { exec } from 'child_process';
import http from 'http';
import { promisify } from 'util';
import WebSocket, { WebSocketServer } from 'ws';

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
    } else if (config.port) {
      this.initializeWebSocketServer(config.port);
    } else {
      throw new Error('Invalid configuration');
    }
    console.log(
      `WebSocketServer created on port ${config.port} for service ${config.serviceName}`
    );
  }

  private initializeWebSocketServer(port: number) {
    try {
      // ポートを使用しているプロセスを確認
      const { stdout } = require('child_process').execSync(`lsof -i :${port} -t`);
      if (stdout.toString().trim()) {
        console.log(`Port ${port} is in use. Attempting to kill the process...`);
        // プロセスを終了
        require('child_process').execSync(`kill -9 ${stdout.toString().trim()}`);

        // ポートが解放されるまで待機
        let retries = 5;
        while (retries > 0) {
          try {
            require('child_process').execSync(`lsof -i :${port} -t`);
            // まだ使用中の場合は少し待って再試行
            require('child_process').execSync('sleep 1');
            retries--;
          } catch (error) {
            // ポートが解放された
            break;
          }
        }
        if (retries === 0) {
          throw new Error(`Port ${port} is still in use after multiple attempts`);
        }
      }
    } catch (error) {
      // エラーが発生した場合（プロセスが見つからない場合など）は無視
      console.log(`No process found using port ${port}`);
    }

    // 新しいWebSocketServerを起動
    this.wss = new WebSocketServer({ port });
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

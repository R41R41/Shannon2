import {
  MinecraftOutput,
  MinecraftServerName,
  ServiceInput,
  ServiceOutput,
  ServiceStatus,
} from '@shannon/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import { BaseClient } from '../common/BaseClient.js';
import { getEventBus } from '../eventBus/index.js';
import dotenv from 'dotenv';
dotenv.config();
const execAsync = promisify(exec);

export class MinecraftClient extends BaseClient {
  private static instance: MinecraftClient;
  private minecraftClients: MinecraftClient[];
  private serverStatuses: Map<string, boolean> = new Map();
  private readonly VALID_SERVERS: MinecraftServerName[] = [
    '1.19.0-test',
    '1.19.0-youtube',
    '1.19.0-play',
  ];
  private readonly SERVER_BASE_PATH = process.env.SERVER_BASE_PATH;
  public isTest: boolean = false;

  public static getInstance(isTest: boolean = false) {
    const eventBus = getEventBus();
    if (!MinecraftClient.instance) {
      MinecraftClient.instance = new MinecraftClient('minecraft', isTest);
    }
    MinecraftClient.instance.isTest = isTest;
    return MinecraftClient.instance;
  }

  constructor(serviceName: 'minecraft', isTest: boolean) {
    const eventBus = getEventBus();
    super(serviceName, eventBus);
    this.minecraftClients = [];
  }

  public async initialize() {
    await this.setupEventBus();
  }

  public async startServer(
    serverName: MinecraftServerName
  ): Promise<{ success: boolean; message: string }> {
    if (this.serverStatuses.get(serverName)) {
      return { success: false, message: 'サーバーは既に起動しています' };
    }

    try {
      const serverPath = `${this.SERVER_BASE_PATH}/${serverName}`;
      await execAsync(`cd ${serverPath} && ./start.sh`);
      this.serverStatuses.set(serverName, true);
      return { success: true, message: `${serverName}を起動しました` };
    } catch (error: any) {
      return {
        success: false,
        message: `サーバー起動エラー: ${error.message}`,
      };
    }
  }

  public async stopServer(
    serverName: MinecraftServerName
  ): Promise<{ success: boolean; message: string }> {
    if (!this.serverStatuses.get(serverName)) {
      return { success: false, message: 'サーバーは既に停止しています' };
    }
    try {
      // screen -S {serverName} -X quit でサーバーを停止
      const screenName = serverName.split('-')[1];
      await execAsync(`screen -S ${screenName} -X quit`);
      this.serverStatuses.set(serverName, false);
      return { success: true, message: `${serverName}を停止しました` };
    } catch (error: any) {
      return {
        success: false,
        message: `サーバー停止エラー: ${error.message}`,
      };
    }
  }

  public async getServerStatus(
    serverName: MinecraftServerName
  ): Promise<ServiceStatus> {
    try {
      const { stdout } = await execAsync('screen -ls');
      const isRunning = stdout.includes(serverName.split('-')[1]);
      this.serverStatuses.set(serverName, isRunning);
      return isRunning ? 'running' : 'stopped';
    } catch (error) {
      // screen -ls が失敗した場合は停止中と判断
      this.serverStatuses.set(serverName, false);
      return 'stopped';
    }
  }

  public async getAllServerStatus(): Promise<
    {
      serverName: MinecraftServerName;
      status: boolean;
    }[]
  > {
    const statuses: { serverName: MinecraftServerName; status: boolean }[] = [];
    try {
      const { stdout } = await execAsync('screen -ls');
      for (const server of this.VALID_SERVERS) {
        const screenName = server.split('-')[1];
        const isRunning = stdout.includes(screenName);
        this.serverStatuses.set(server, isRunning);
        statuses.push({ serverName: server, status: isRunning });
      }
    } catch (error) {
      // screen -ls が失敗した場合は全て停止中と判断
      for (const server of this.VALID_SERVERS) {
        this.serverStatuses.set(server, false);
        statuses.push({ serverName: server, status: false });
      }
    }
    return statuses;
  }

  private async setupEventBus() {
    this.eventBus.subscribe('minecraft:status', async (event) => {
      const { serviceCommand } = event.data as ServiceInput;
      if (serviceCommand === 'start') {
        await this.start();
      } else if (serviceCommand === 'stop') {
        await this.stop();
      } else if (serviceCommand === 'status') {
        this.eventBus.publish({
          type: 'web:status',
          memoryZone: 'web',
          data: {
            service: 'minecraft',
            status: this.status,
          },
        });
      }
    });
    // サーバー管理用のイベントハンドラを設定
    for (const server of this.VALID_SERVERS) {
      this.eventBus.subscribe(`minecraft:${server}:status`, async (event) => {
        if (this.status !== 'running') return;
        const { serviceCommand } = event.data as ServiceInput;
        if (serviceCommand === 'start') {
          const result = await this.startServer(server);
          console.log('MinecraftClient: Start server result:', result);
          const status = await this.getServerStatus(server);
          this.eventBus.publish({
            type: `web:status`,
            memoryZone: 'web',
            data: {
              service: `minecraft:${server}`,
              status: status,
            } as ServiceOutput,
          });
        } else if (serviceCommand === 'stop') {
          const result = await this.stopServer(server);
          console.log('MinecraftClient: Stop server result:', result);
          const status = await this.getServerStatus(server);
          this.eventBus.publish({
            type: `web:status`,
            memoryZone: 'web',
            data: {
              service: `minecraft:${server}`,
              status: status,
            } as ServiceOutput,
          });
        } else if (serviceCommand === 'status') {
          const status = await this.getServerStatus(server);
          this.eventBus.publish({
            type: `web:status`,
            memoryZone: 'web',
            data: {
              service: `minecraft:${server}`,
              status: status,
            } as ServiceOutput,
          });
        }
      });
    }
  }
}

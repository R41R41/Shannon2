import {
  MinebotInput,
  MinebotStartOrStopInput,
  ServiceInput,
  ServiceOutput,
} from '@shannon/common';
import dotenv from 'dotenv';
import pkg from 'minecrafthawkeye';
import mineflayer from 'mineflayer';
import { plugin as cmd } from 'mineflayer-cmd';
import { plugin as collectBlock } from 'mineflayer-collectblock';
import { pathfinder } from 'mineflayer-pathfinder';
import { plugin as projectile } from 'mineflayer-projectile';
import { plugin as pvp } from 'mineflayer-pvp';
import { plugin as toolPlugin } from 'mineflayer-tool';
import { BaseClient } from '../common/BaseClient.js';
import { getEventBus } from '../eventBus/index.js';
import { SkillAgent } from './skillAgent.js';
import { ConstantSkills, CustomBot, InstantSkills } from './types.js';
import { Utils } from './utils/index.js';
dotenv.config();

if (
  !process.env.MINECRAFT_BOT_USER_NAME ||
  !process.env.MINECRAFT_BOT_PASSWORD
) {
  throw new Error(
    'MINECRAFT_BOT_USER_NAME and MINECRAFT_BOT_PASSWORD must be set'
  );
}

const ports = {
  '1.21.4-test': 25566,
  '1.19.0-youtube': 25564,
  '1.21.1-play': 25565,
};

export class MinebotClient extends BaseClient {
  private bot: CustomBot | null = null;
  public isDev: boolean = false;
  private static instance: MinebotClient;
  private skillAgent: SkillAgent | null = null;

  constructor(serviceName: 'minebot', isDev: boolean) {
    const eventBus = getEventBus();
    super(serviceName, eventBus);
  }

  public static getInstance(isDev: boolean = false) {
    const eventBus = getEventBus();
    if (!MinebotClient.instance) {
      MinebotClient.instance = new MinebotClient('minebot', isDev);
    }
    MinebotClient.instance.isDev = isDev;
    return MinebotClient.instance;
  }

  private async setUpBot(data: MinebotInput) {
    const username = process.env.MINECRAFT_BOT_USER_NAME;
    const password = process.env.MINECRAFT_BOT_PASSWORD;

    if (!password || !username) {
      throw new Error('必要な環境変数が設定されていません');
    }
    const { serverName } = data as MinebotStartOrStopInput;
    const port = ports[serverName as keyof typeof ports];
    const version = serverName?.split('-')[0];

    console.log(`${port} ${version}に接続します`);

    this.bot = mineflayer.createBot({
      host: '127.0.0.1',
      port,
      username,
      auth: 'microsoft',
      version,
      checkTimeoutInterval: 60 * 60 * 1000,
      skipValidation: true,
    }) as CustomBot;

    this.bot.loadPlugin(pathfinder);
    this.bot.loadPlugin(collectBlock);
    this.bot.loadPlugin(projectile);
    this.bot.loadPlugin(pvp);
    this.bot.loadPlugin(toolPlugin);
    cmd.allowConsoleInput = true;
    this.bot.loadPlugin(cmd);
    console.log(pkg);
    const minecraftHawkEye = pkg.default;
    try {
      this.bot.loadPlugin(minecraftHawkEye);
    } catch (error) {
      console.log('error', error);
    }

    this.bot.on('login', async () => {
      this.eventBus.log('minecraft', 'green', 'Bot has logged in.');
    });

    this.bot.isTest =
      process.env.IS_DEV === 'True' || process.argv[3] === 'dev';
    this.bot.chatMode = true;
    this.bot.attackEntity = null;
    this.bot.runFromEntity = null;
    this.bot.goal = null;
    this.bot.instantSkills = new InstantSkills();
    this.bot.constantSkills = new ConstantSkills();
    this.bot.utils = new Utils(this.bot);
    this.bot.selfState = {
      botPosition: null,
      botHealth: '20/20',
      botFoodLevel: '20/20',
      botHeldItem: '',
      lookingAt: null,
      inventory: [],
    };
    this.bot.environmentState = {
      senderName: '',
      senderPosition: '',
      weather: '',
      time: '',
      biome: '',
      dimension: '',
      bossbar: null,
    };
    await new Promise((resolve) => setTimeout(resolve, 1000));
    this.bot.utils.setMovements(
      this.bot,
      true,
      true,
      true,
      true,
      true,
      true,
      1,
      true
    );

    this.bot.on('respawn', () => {
      if (!this.bot) {
        throw new Error('Botが初期化されていません');
      }
      this.bot.attackEntity = null;
      this.bot.runFromEntity = null;
      this.bot.goal = null;
      this.eventBus.log('minecraft', 'green', 'Bot has respawned.');
    });

    this.skillAgent = new SkillAgent(this.bot, this.eventBus);
    const result = await this.skillAgent.startAgent();
    if (!result.success) {
      this.eventBus.log(
        'minecraft',
        'red',
        `Skill agent failed to start: ${result.result}`
      );
      throw new Error(`Skill agent failed to start: ${result.result}`);
    }

    process.on('uncaughtException', (error) => {
      this.eventBus.log(
        'minecraft',
        'red',
        `未処理の例外が発生しました: ${error.message}`
      );
    });

    process.on('unhandledRejection', (reason: unknown, promise) => {
      const error =
        reason instanceof Error ? reason : new Error(String(reason));
      this.eventBus.log(
        'minecraft',
        'red',
        `未処理のPromise拒否が発生しました: ${error.message}`
      );
    });

    this.bot.on('spawn', () => {
      this.eventBus.log('minecraft', 'green', 'Minecraft bot spawned');
    });
  }

  private getStatus() {
    if (!this.bot) {
      return 'stopped';
    }
    return 'running';
  }

  public async initialize() {
    await this.setupEventBus();
  }

  private async setupEventBus() {
    this.eventBus.subscribe('minebot:status', async (event) => {
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
            service: 'minebot',
            status: this.status,
          },
        });
      }
    });
    this.eventBus.subscribe('minebot:bot:status', async (event) => {
      if (this.status !== 'running') return;
      const { serviceCommand } = event.data as ServiceInput;
      if (serviceCommand === 'start') {
        const result = await this.startBot(event.data as MinebotInput);
        if (!result) return;
        const status = this.getStatus();
        this.eventBus.publish({
          type: `web:status`,
          memoryZone: 'web',
          data: {
            service: `minebot:bot`,
            status: status,
          } as ServiceOutput,
        });
      } else if (serviceCommand === 'stop') {
        const result = await this.stopBot(event.data as MinebotInput);
        if (!result) return;
        const status = this.getStatus();
        this.eventBus.publish({
          type: `web:status`,
          memoryZone: 'web',
          data: {
            service: `minebot:bot`,
            status: status,
          } as ServiceOutput,
        });
      } else if (serviceCommand === 'status') {
        const status = this.getStatus();
        this.eventBus.publish({
          type: 'web:status',
          memoryZone: 'web',
          data: {
            service: 'minebot:bot',
            status: status,
          } as ServiceOutput,
        });
      }
    });
  }

  private async startBot(data: MinebotInput) {
    try {
      await this.setUpBot(data);
      this.eventBus.log('minecraft', 'green', 'Minecraft bot started');
      return true;
    } catch (error) {
      this.eventBus.log(
        'minecraft',
        'red',
        `Botの起動に失敗しました: ${error}`
      );
      return false;
    }
  }

  private async stopBot(data: MinebotInput) {
    try {
      if (!this.bot) {
        throw new Error('Botが初期化されていません');
      }
      // port 8082を開放
      if (this.skillAgent?.server) {
        this.skillAgent.server.close(() => {
          console.log('Express server on 8082 closed');
        });
        this.skillAgent.server = null;
      }
      this.bot.quit();
      this.bot = null;
      this.eventBus.log('minecraft', 'green', 'Minecraft bot stopped');
      return true;
    } catch (error) {
      this.eventBus.log(
        'minecraft',
        'red',
        `Botの停止に失敗しました: ${error}`
      );
      return false;
    }
  }
}

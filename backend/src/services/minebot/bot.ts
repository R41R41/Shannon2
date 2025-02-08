import { MinebotInput, MinebotOutput } from '@shannon/common';
import dotenv from 'dotenv';
import minecraftHawkEye from 'minecrafthawkeye';
import mineflayer from 'mineflayer';
import { plugin as collectBlock } from 'mineflayer-collectblock';
import { pathfinder } from 'mineflayer-pathfinder';
import projectile from 'mineflayer-projectile';
import pvp from 'mineflayer-pvp';
import toolPlugin from 'mineflayer-tool';
import { EventBus } from '../eventBus.js';
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

export class MinecraftBot {
  private bot: CustomBot;
  private eventBus: EventBus;

  constructor(eventBus: EventBus, port: number) {
    const username = process.env.MINECRAFT_BOT_USER_NAME;
    const password = process.env.MINECRAFT_BOT_PASSWORD;

    if (!password || !username) {
      throw new Error('必要な環境変数が設定されていません');
    }

    this.bot = mineflayer.createBot({
      host: '127.0.0.1',
      port,
      username,
      password,
      auth: 'microsoft',
      // disableChatSigning: true,
      checkTimeoutInterval: 60 * 60 * 1000,
      version: '1.19',
    }) as CustomBot;
    this.setUpBot();
    this.eventBus = eventBus;
  }

  private setUpBot() {
    this.bot.loadPlugin(pathfinder);
    this.bot.loadPlugin(collectBlock);
    this.bot.loadPlugin(minecraftHawkEye);
    this.bot.loadPlugin(pvp);
    this.bot.loadPlugin(toolPlugin);
    this.bot.loadPlugin(projectile);

    this.bot.on('login', async () => {
      this.eventBus.log('minecraft', 'green', 'Bot has logged in.');
    });

    this.bot.isTest =
      process.env.IS_TEST === 'True' || process.argv[3] === 'test';
    this.bot.chatMode = true;
    this.bot.attackEntity = null;
    this.bot.runFromEntity = null;
    this.bot.goal = null;
    this.bot.instantSkills = new InstantSkills();
    this.bot.constantSkills = new ConstantSkills();
    this.bot.utils = new Utils(this.bot);

    this.bot.on('respawn', () => {
      this.bot.attackEntity = null;
      this.bot.runFromEntity = null;
      this.bot.goal = null;
      this.eventBus.log('minecraft', 'green', 'Bot has respawned.');
    });

    const skillAgent = new SkillAgent(this.bot, this.eventBus);

    async function startBot(this: MinecraftBot) {
      const startServerResponse = await skillAgent.startServer();
      if (!startServerResponse.success) {
        this.eventBus.log(
          'minecraft',
          'red',
          `botの正常な起動に失敗しました: ${startServerResponse.result}`
        );
      }
    }

    startBot.bind(this)();

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
  }

  public start() {
    this.bot.on('spawn', () => {
      this.eventBus.log('minecraft', 'green', 'Minecraft bot spawned');
    });
  }
}

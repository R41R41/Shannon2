import express from 'express';
import mongoose from 'mongoose';
import { DiscordBot } from './services/discord/client.js';
import { Scheduler } from './services/scheduler/client.js';
import { YoutubeClient } from './services/youtube/client.js';
import dotenv from 'dotenv';
import { discordRoutes } from './routes/discord.routes.js';
import { twitterRoutes } from './routes/twitter.routes.js';
import { LLMService } from './services/llm/client.js';
import { TwitterClient } from './services/twitter/client.js';
import { WebClient } from './services/web/client.js';
import { MinecraftClient } from './services/minecraft/client.js';
import { MinebotClient } from './services/minebot/client.js';
dotenv.config();

class Server {
  private app = express();
  private llmService: LLMService;
  private discordBot: DiscordBot;
  private webClient: WebClient;
  private twitterClient: TwitterClient;
  private scheduler: Scheduler;
  private youtubeClient: YoutubeClient;
  private minecraftClient: MinecraftClient;
  private minebotClient: MinebotClient;

  constructor() {
    this.llmService = new LLMService();
    const isTestMode = process.argv.includes('--test');
    this.discordBot = DiscordBot.getInstance(isTestMode);
    this.webClient = new WebClient(isTestMode);
    this.twitterClient = TwitterClient.getInstance(isTestMode);
    this.scheduler = Scheduler.getInstance(isTestMode);
    this.youtubeClient = YoutubeClient.getInstance(isTestMode);
    this.minecraftClient = MinecraftClient.getInstance(isTestMode);
    this.minebotClient = MinebotClient.getInstance(isTestMode);
  }

  private setupRoutes() {
    // APIルートの設定
    this.app.use('/api/twitter', twitterRoutes);
    this.app.use('/api/discord', discordRoutes);
    // その他のルート
  }

  private async connectDatabase() {
    try {
      await mongoose.connect(process.env.MONGODB_URI as string);
      console.log('\x1b[34mMongoDB connected\x1b[0m');
    } catch (error) {
      console.error(`\x1b[31mMongoDB connection error: ${error}\x1b[0m`);
    }
  }

  public async start() {
    try {
      await Promise.all([
        this.startDiscordBot(),
        this.startWebClient(),
        this.startLLMService(),
        this.startTwitterClient(),
        this.connectDatabase(),
        this.startScheduler(),
        this.startYoutubeClient(),
        this.startMinecraftClient(),
        this.startMinebotClient(),
      ]);
    } catch (error) {
      console.error(`\x1b[31mサービス起動エラー: ${error}\x1b[0m`);
      process.exit(1);
    }
  }

  private async startDiscordBot() {
    await this.discordBot.start();
  }

  private async startWebClient() {
    await this.webClient.start();
    console.log('\x1b[34mWeb Client started\x1b[0m');
  }

  private async startTwitterClient() {
    await this.twitterClient.start();
    console.log('\x1b[34mTwitter Client started\x1b[0m');
  }

  private async startLLMService() {
    await this.llmService.initialize();
    console.log('\x1b[34mLLM Service started\x1b[0m');
  }

  private async startScheduler() {
    await this.scheduler.start();
    console.log('\x1b[34mScheduler started\x1b[0m');
  }

  private async startYoutubeClient() {
    await this.youtubeClient.start();
    console.log('\x1b[34mYoutube Client started\x1b[0m');
  }

  private async startMinecraftClient() {
    await this.minecraftClient.start();
    console.log('\x1b[34mMinecraft Client started\x1b[0m');
  }

  private async startMinebotClient() {
    await this.minebotClient.start();
    console.log('\x1b[34mMinebot Client started\x1b[0m');
  }

  public async shutdown() {
    // 各サービスのクリーンアップ処理
    await mongoose.disconnect();
    console.log('\x1b[31mMongoDB disconnected\x1b[0m');
    process.exit(0);
  }
}

// サーバーのインスタンス化と起動
const server = new Server();
server.start();

// グレースフルシャットダウンの処理
process.on('SIGTERM', () => server.shutdown());
process.on('SIGINT', () => server.shutdown());

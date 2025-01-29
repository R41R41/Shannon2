import express from 'express';
import mongoose from 'mongoose';
import { Scheduler } from './services/scheduler/client.js';
import { DiscordBot } from './services/discord/client.js';
// import { YoutubeService } from './services/youtube/client.js';
// import { MinecraftBot } from './services/minecraft/bot.js';
import { LLMService } from './services/llm/client.js';
import { EventBus } from './services/eventBus.js';
import { twitterRoutes } from './routes/twitter.routes.js';
import { discordRoutes } from './routes/discord.routes.js';
import dotenv from 'dotenv';
import { TwitterClient } from './services/twitter/client.js';
import { WebClient } from './services/web/client.js';
import { MonitoringService } from './services/monitoring/client.js';
import cors from 'cors';

dotenv.config();

class Server {
  private app = express();
  private monitoringService: MonitoringService;
  private eventBus: EventBus;
  private llmService: LLMService;
  private discordBot: DiscordBot;
  private webClient: WebClient;
  private twitterClient: TwitterClient;
  private scheduler: Scheduler;
  //   private youtubeService: YoutubeService;
  //   private minecraftBot: MinecraftBot;

  constructor() {
    this.eventBus = new EventBus();
    this.llmService = new LLMService(this.eventBus);
    const isTestMode = process.argv.includes('--test');
    this.discordBot = new DiscordBot(this.eventBus, isTestMode);
    this.webClient = new WebClient(this.eventBus);
    this.monitoringService = new MonitoringService(this.eventBus);
    this.twitterClient = new TwitterClient(this.eventBus, isTestMode);
    this.scheduler = new Scheduler(this.eventBus);
  }

  private setupMiddleware() {
    this.app.use(express.json());
    this.app.use(
      cors({
        origin: ['http://20.243.208.67:3000', 'http://localhost:3000'],
        credentials: true,
      })
    );
    // その他のミドルウェア設定
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
        this.startMonitoringService(),
        this.startScheduler(),
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

  private async startMonitoringService() {
    await this.monitoringService.initialize();
    console.log('\x1b[34mMonitoring Service started\x1b[0m');
  }

  private async startTwitterClient() {
    await this.twitterClient.initialize();
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

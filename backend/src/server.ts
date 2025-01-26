import express from 'express';
import mongoose from 'mongoose';
// import { TwitterScheduler } from './services/twitter/scheduler.js';
import { DiscordBot } from './services/discord/client.js';
// import { YoutubeService } from './services/youtube/client.js';
// import { MinecraftBot } from './services/minecraft/bot.js';
import { LLMService } from './services/llm/client.js';
import { EventBus } from './services/eventBus.js';
// import { twitterRoutes } from './routes/twitter.routes.js';
import { discordRoutes } from './routes/discord.routes.js';
import dotenv from 'dotenv';
// import { TwitterClient } from './services/twitter/client.js';
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
  // private twitterClient: TwitterClient;
  //   private youtubeService: YoutubeService;
  //   private minecraftBot: MinecraftBot;

  constructor() {
    this.eventBus = new EventBus();
    this.llmService = new LLMService(this.eventBus);
    this.discordBot = new DiscordBot(this.eventBus);
    this.webClient = new WebClient(this.eventBus);
    this.monitoringService = new MonitoringService(this.eventBus);
    // this.twitterClient = new TwitterClient(this.eventBus);
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
    // this.app.use('/api/twitter', twitterRoutes);
    this.app.use('/api/discord', discordRoutes);
    // その他のルート
  }

  private async connectDatabase() {
    try {
      await mongoose.connect(process.env.MONGODB_URI as string);
      console.log('MongoDB connected');
    } catch (error) {
      console.error('MongoDB connection error:', error);
    }
  }

  public async start() {
    try {
      await Promise.all([
        this.startDiscordBot(),
        this.startWebClient(),
        this.startLLMService(),
        this.connectDatabase(),
        this.startMonitoringService(),
      ]);
    } catch (error) {
      console.error('サービス起動エラー:', error);
      process.exit(1);
    }
  }

  private async startDiscordBot() {
    await this.discordBot.start();
    console.log('Discord Bot started');
  }

  private async startWebClient() {
    await this.webClient.start();
    console.log('Web Client started');
  }

  private async startMonitoringService() {
    await this.monitoringService.initialize();
    console.log('Monitoring Service started');
  }

  // private async startTwitterClient() {
  //   await this.twitterClient.initialize();
  //   console.log('Twitter Client started');
  // }

  private async startLLMService() {
    await this.llmService.initialize();
    console.log('LLM Service started');
  }

  public async shutdown() {
    // 各サービスのクリーンアップ処理
    await mongoose.disconnect();
    process.exit(0);
  }
}

// サーバーのインスタンス化と起動
const server = new Server();
server.start();

// グレースフルシャットダウンの処理
process.on('SIGTERM', () => server.shutdown());
process.on('SIGINT', () => server.shutdown());

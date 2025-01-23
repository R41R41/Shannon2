import express from 'express';
import mongoose from 'mongoose';
// import { TwitterScheduler } from './services/twitter/scheduler.js';
import { DiscordBot } from './services/discord/client.js';
// import { YoutubeService } from './services/youtube/client.js';
// import { MinecraftBot } from './services/minecraft/bot.js';
import { LLMService } from './services/llm/client.js';
import { EventBus } from './services/llm/eventBus.js';
// import { twitterRoutes } from './routes/twitter.routes.js';
import { discordRoutes } from './routes/discord.routes.js';
import dotenv from 'dotenv';
// import { TwitterClient } from './services/twitter/client.js';

dotenv.config();

class Server {
  private app = express();
//   private twitterScheduler: TwitterScheduler;
  private eventBus: EventBus;
  private llmService: LLMService;
  private discordBot: DiscordBot;
  // private twitterClient: TwitterClient;
//   private youtubeService: YoutubeService;
//   private minecraftBot: MinecraftBot;

  constructor() {
    this.eventBus = new EventBus();
    this.llmService = new LLMService(this.eventBus);
    this.discordBot = new DiscordBot(this.eventBus);
    // this.twitterClient = new TwitterClient(this.eventBus);
  }

  private setupMiddleware() {
    this.app.use(express.json());
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
      // 各サービスを並列で起動
      await Promise.all([
        this.startDiscordBot(),
        // this.startTwitterClient(),
        this.startLLMService(),
        this.connectDatabase()
      ]);

      const PORT = process.env.PORT || 5000;
      this.app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
      });
    } catch (error) {
      console.error('サービス起動エラー:', error);
      process.exit(1);
    }
  }

  private async startDiscordBot() {
    await this.discordBot.start();
    console.log('Discord Bot started');
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

import mongoose from 'mongoose';
import { DiscordBot } from './services/discord/client.js';
import { Scheduler } from './services/scheduler/client.js';
import { YoutubeClient } from './services/youtube/client.js';
import dotenv from 'dotenv';
import { LLMService } from './services/llm/client.js';
import { TwitterClient } from './services/twitter/client.js';
import { WebClient } from './services/web/client.js';
import { MinecraftClient } from './services/minecraft/client.js';
import { MinebotClient } from './services/minebot/client.js';
import { NotionClient } from './services/notion/client.js';
dotenv.config();

class Server {
  private llmService: LLMService;
  private discordBot: DiscordBot;
  private webClient: WebClient;
  private twitterClient: TwitterClient;
  private scheduler: Scheduler;
  private youtubeClient: YoutubeClient;
  private minecraftClient: MinecraftClient;
  private minebotClient: MinebotClient;
  private notionClient: NotionClient;
  constructor() {
    const isDevMode = process.argv.includes('--dev');
    this.llmService = LLMService.getInstance(isDevMode);
    this.discordBot = DiscordBot.getInstance(isDevMode);
    this.webClient = WebClient.getInstance(isDevMode);
    this.twitterClient = TwitterClient.getInstance(isDevMode);
    this.scheduler = Scheduler.getInstance(isDevMode);
    this.youtubeClient = YoutubeClient.getInstance(isDevMode);
    this.minecraftClient = MinecraftClient.getInstance(isDevMode);
    this.minebotClient = MinebotClient.getInstance(isDevMode);
    this.notionClient = NotionClient.getInstance(isDevMode);
  }

  private async connectDatabase() {
    try {
      const uri = process.env.MONGODB_URI as string;
      console.log('Connecting to MongoDB:', uri); // URIを確認
      await mongoose.connect(uri);
      console.log(
        '\x1b[34mMongoDB connected to:',
        mongoose.connection.db.databaseName,
        '\x1b[0m'
      ); // DB名を確認
    } catch (error) {
      console.error(`\x1b[31mMongoDB connection error: ${error}\x1b[0m`);
    }
  }

  public async start() {
    try {
      // データベース接続を最初に行う
      await this.connectDatabase();

      await Promise.all([
        this.startDiscordBot(),
        this.startWebClient(),
        this.startLLMService(),
        this.startTwitterClient(),
        this.startScheduler(),
        this.startYoutubeClient(),
        this.startMinecraftClient(),
        this.startMinebotClient(),
        this.startNotionClient(),
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
    try {
      await this.youtubeClient.start();
      console.log('\x1b[34mYoutube Client started\x1b[0m');
    } catch (error) {
      console.error(`\x1b[31mYoutube Client start error: ${error}\x1b[0m`);
      console.warn('\x1b[33mContinuing without Youtube functionality\x1b[0m');
    }
  }

  private async startMinecraftClient() {
    await this.minecraftClient.start();
    console.log('\x1b[34mMinecraft Client started\x1b[0m');
  }

  private async startMinebotClient() {
    await this.minebotClient.start();
    console.log('\x1b[34mMinebot Client started\x1b[0m');
  }

  private async startNotionClient() {
    await this.notionClient.start();
    console.log('\x1b[34mNotion Client started\x1b[0m');
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

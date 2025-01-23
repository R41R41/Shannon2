import mineflayer from 'mineflayer';
import { LLMService } from '../llm/client.js';

export class MinecraftBot {
  private bot: mineflayer.Bot;
  private llm: LLMService;

  constructor() {
    const host = process.env.MC_HOST;
    const username = process.env.MC_USERNAME;
    
    if (!host || !username) {
      throw new Error('必要な環境変数が設定されていません');
    }

    this.bot = mineflayer.createBot({
      host,
      port: parseInt(process.env.MC_PORT || '25565'),
      username
    });
    this.llm = new LLMService();
    this.setupEvents();
  }

  private setupEvents() {
    this.bot.on('chat', async (username, message) => {
      // チャット処理とLLM連携
    });
  }
} 
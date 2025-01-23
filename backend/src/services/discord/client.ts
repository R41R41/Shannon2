import { Client, GatewayIntentBits } from 'discord.js';
import { LLMService } from '../llm/client.js';

export class DiscordBot {
  private client: Client;
  private llm: LLMService;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });
    this.llm = new LLMService();
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.client.on('messageCreate', async message => {
      // メッセージ処理とLLM連携
    });
  }
} 
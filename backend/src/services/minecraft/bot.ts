import mineflayer from 'mineflayer';
import { EventBus } from '../eventBus.js';
import { LLMMessage } from '../llm/types/index.js';

export class MinecraftBot {
  private bot: mineflayer.Bot;
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    const host = process.env.MC_HOST;
    const username = process.env.MC_USERNAME;

    if (!host || !username) {
      throw new Error('必要な環境変数が設定されていません');
    }

    this.bot = mineflayer.createBot({
      host,
      port: parseInt(process.env.MC_PORT || '25565'),
      username,
    });

    this.eventBus = eventBus;
    this.setupEvents();
  }

  private setupEvents() {
    this.bot.on('chat', async (username, message) => {
      if (username === this.bot.username) return;

      const llmMessage: LLMMessage = {
        platform: 'minecraft',
        type: 'text',
        content: message,
        context: {
          username: username,
        },
      };
      this.eventBus.publish({
        type: 'minecraft:message',
        platform: 'minecraft',
        data: llmMessage,
      });
    });

    this.eventBus.subscribe('minecraft:message', (event) => {
      this.bot.chat(event.data.content);
    });
  }

  public start() {
    this.bot.on('spawn', () => {
      console.log('Minecraft bot spawned');
    });
  }
}

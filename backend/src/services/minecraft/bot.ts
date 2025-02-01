import { MinecraftInput, MinecraftOutput } from '@shannon/common';
import mineflayer from 'mineflayer';
import { EventBus } from '../eventBus.js';

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

      const minecraftInput: MinecraftInput = {
        type: 'text',
        text: message,
      };
      this.eventBus.publish({
        type: 'minecraft:get_message',
        memoryZone: 'minecraft',
        data: minecraftInput,
      });
    });

    this.eventBus.subscribe('minecraft:post_message', (event) => {
      const { type, text, endpoint } = event.data as MinecraftOutput;
      if (text && type === 'text') {
        this.bot.chat(text);
      }
    });
  }

  public start() {
    this.bot.on('spawn', () => {
      console.log('Minecraft bot spawned');
    });
  }
}

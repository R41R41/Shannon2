import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { getEventBus } from '../../eventBus/index.js';
import { DiscordClientInput, MemoryZone } from '@shannon/common';
import { EventBus } from '../../eventBus/eventBus.js';

export default class ChatOnDiscordTool extends StructuredTool {
  name = 'chat-on-discord';
  description = 'A tool to send a message to Discord.';
  schema = z.object({
    message: z.string().describe('The message you want to send.'),
    channelId: z.string().describe('The channel ID you want to send to.'),
    guildId: z.string().describe('The server ID you want to send to.'),
    memoryZone: z.string().describe('The value of MemoryZone.'),
  });
  private eventBus: EventBus;

  constructor() {
    super();
    this.eventBus = getEventBus();
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      // console.log('\x1b[35mchat-on-discord', data, '\x1b[0m');
      this.eventBus.publish({
        type: 'discord:post_message',
        memoryZone: data.memoryZone as MemoryZone,
        data: {
          type: 'text',
          channelId: data.channelId,
          guildId: data.guildId,
          text: data.message,
        } as DiscordClientInput,
      });
      const currentTime = new Date().toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
      });
      return `${currentTime} Sent a message to Discord: ${data.message}`;
    } catch (error) {
      console.error('Bing search error:', error);
      return `An error occurred while searching: ${error}`;
    }
  }
}

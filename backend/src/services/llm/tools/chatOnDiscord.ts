import { StructuredTool } from '@langchain/core/tools';
import { DiscordClientInput, MemoryZone } from '@shannon/common';
import { z } from 'zod';
import { EventBus } from '../../eventBus/eventBus.js';
import { getEventBus } from '../../eventBus/index.js';

export default class ChatOnDiscordTool extends StructuredTool {
  name = 'chat-on-discord';
  description = 'A tool to send a message to Discord.';
  schema = z.object({
    message: z.string().describe('The message you want to send.'),
    channelId: z.string().describe('The channel ID you want to send to.'),
    guildId: z.string().describe('The server ID you want to send to.'),
    memoryZone: z
      .string()
      .optional()
      .describe('The value of MemoryZone. Optional, defaults to discord:general.'),
    imageUrl: z
      .string()
      .optional()
      .describe(
        'The image URL you want to send. Optional - only set if you want to send an image.'
      ),
  });
  private eventBus: EventBus;

  constructor() {
    super();
    this.eventBus = getEventBus();
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      // console.log('\x1b[35mchat-on-discord', data, '\x1b[0m');
      const memoryZone = (data.memoryZone || 'discord:general') as MemoryZone;
      this.eventBus.publish({
        type: 'discord:post_message',
        memoryZone,
        data: {
          type: 'text',
          channelId: data.channelId,
          guildId: data.guildId,
          text: data.message,
          imageUrl: data.imageUrl,
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

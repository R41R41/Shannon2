import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { EventBus } from '../../eventBus/eventBus.js';
import { DiscordClientInput, MemoryZone } from '@shannon/common';
export default class ChatOnDiscordTool extends StructuredTool {
  name = 'chat-on-discord';
  description = 'Discordでチャットを送信するツール。';
  schema = z.object({
    message: z.string().describe('送信したいメッセージ'),
    channelId: z.string().describe('送信先のチャンネルID'),
    guildId: z.string().describe('送信先のサーバーID'),
    memoryZone: z.string().describe('MemoryZoneの値'),
  });

  constructor() {
    super();
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      console.log('\x1b[35mchat-on-discord', data, '\x1b[0m');
      const eventBus = new EventBus();
      eventBus.publish({
        type: 'discord:post_message',
        memoryZone: data.memoryZone as MemoryZone,
        data: {
          type: 'text',
          channelId: data.channelId,
          guildId: data.guildId,
          message: data.message,
        } as DiscordClientInput,
      });
      return 'メッセージを送信しました。';
    } catch (error) {
      console.error('Bing search error:', error);
      return `検索中にエラーが発生しました: ${error}`;
    }
  }
}

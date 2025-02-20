import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { getEventBus } from '../../eventBus/index.js';
import {
  DiscordGetServerEmojiInput,
  DiscordGetServerEmojiOutput,
} from '@shannon/common';
import { EventBus } from '../../eventBus/eventBus.js';

export default class GetServerEmojiOnDiscordTool extends StructuredTool {
  name = 'get-server-emoji-on-discord';
  description = 'Discordでサーバー固有絵文字を取得するツール。';
  schema = z.object({
    guildId: z.string().describe('取得したいサーバーのGuildId'),
  });

  private eventBus: EventBus;

  constructor() {
    super();
    this.eventBus = getEventBus();
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      // emojiIdを取得するPromiseを作成
      const getEmojis = new Promise<string[]>((resolve) => {
        // subscribeを設定
        this.eventBus.subscribe('tool:get_server_emoji', (event) => {
          const { emojis } = event.data as DiscordGetServerEmojiOutput;
          resolve(emojis);
        });

        // emoji取得要請を送信
        this.eventBus.publish({
          type: 'discord:get_server_emoji',
          memoryZone: 'null',
          data: {
            guildId: data.guildId,
          } as DiscordGetServerEmojiInput,
        });
      });

      // emojiIdを待機
      const emojis = await getEmojis;

      const currentTime = new Date().toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
      });
      return `${currentTime} discordのサーバー固有絵文字のリストを取得しました。\n${emojis}`;
    } catch (error) {
      console.error('Discord emoji error:', error);
      return `絵文字の送信中にエラーが発生しました: ${error}`;
    }
  }
}

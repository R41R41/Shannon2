import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { getEventBus } from '../../eventBus/index.js';
import {
  DiscordSendServerEmojiInput,
  DiscordSendServerEmojiOutput,
} from '@shannon/common';
import { EventBus } from '../../eventBus/eventBus.js';

export default class ReactByServerEmojiOnDiscordTool extends StructuredTool {
  name = 'react-by-server-emoji-on-discord';
  description =
    'Discordでサーバー固有絵文字で特定のメッセージにリアクションするツール。';
  schema = z.object({
    guildId: z.string().describe('リアクションしたいサーバーのGuildId'),
    channelId: z.string().describe('リアクションしたいチャンネルのChannelId'),
    messageId: z.string().describe('リアクションしたいメッセージのMessageId'),
    emojiId: z.string().describe('リアクションしたい絵文字のEmojiId'),
  });

  private eventBus: EventBus;

  constructor() {
    super();
    this.eventBus = getEventBus();
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      // emojiIdを取得するPromiseを作成
      const getResult = new Promise<{
        isSuccess: boolean;
        errorMessage: string;
      }>((resolve) => {
        // subscribeを設定
        this.eventBus.subscribe('tool:send_server_emoji', (event) => {
          const { isSuccess, errorMessage } =
            event.data as DiscordSendServerEmojiOutput;
          resolve({ isSuccess, errorMessage });
        });

        // emoji取得要請を送信
        this.eventBus.publish({
          type: 'discord:send_server_emoji',
          memoryZone: 'null',
          data: {
            guildId: data.guildId,
            channelId: data.channelId,
            messageId: data.messageId,
            emojiId: data.emojiId,
          } as DiscordSendServerEmojiInput,
        });
      });

      // emojiIdを待機
      const result = await getResult;

      const currentTime = new Date().toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
      });
      if (result.isSuccess) {
        return `${currentTime} リアクションを送信しました。`;
      } else {
        return `${currentTime} リアクションを送信できませんでした。${result.errorMessage}`;
      }
    } catch (error) {
      console.error('Discord emoji error:', error);
      return `絵文字の送信中にエラーが発生しました: ${error}`;
    }
  }
}

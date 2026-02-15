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
    'Discordのメッセージに絵文字でリアクションするツール。emojiには Unicode絵文字（例: "😂", "👍", "🎉"）またはサーバーカスタム絵文字のID を指定できる。';
  schema = z.object({
    guildId: z
      .string()
      .describe('GuildId of the server where you want to react'),
    channelId: z
      .string()
      .describe('ChannelId of the channel where you want to react'),
    messageId: z
      .string()
      .describe('MessageId of the message you want to react to'),
    emojiId: z.string().describe('Unicode絵文字（例: "😂"）またはサーバーカスタム絵文字のID'),
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
        return `${currentTime} Reaction sent.`;
      } else {
        return `${currentTime} Could not send reaction. ${result.errorMessage}`;
      }
    } catch (error) {
      console.error('Discord emoji error:', error);
      return `An error occurred while sending an emoji: ${error}`;
    }
  }
}

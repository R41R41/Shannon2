import { StructuredTool } from '@langchain/core/tools';
import { TwitterClientInput } from '@shannon/common';
import { z } from 'zod';
import { EventBus } from '../../eventBus/eventBus.js';
import { getEventBus } from '../../eventBus/index.js';

export default class PostOnTwitterTool extends StructuredTool {
  name = 'post-on-twitter';
  description =
    'X(Twitter)にツイートを投稿するツール。新規ツイートの投稿と、既存ツイートへの返信の両方に対応。返信する場合は replyToTweetId を指定する。';
  schema = z.object({
    text: z.string().describe('投稿するテキスト。280文字以内。'),
    replyToTweetId: z
      .string()
      .optional()
      .describe(
        '返信先のツイートID。返信する場合のみ指定。新規ツイートの場合は省略。'
      ),
  });

  private eventBus: EventBus;

  constructor() {
    super();
    this.eventBus = getEventBus();
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      this.eventBus.publish({
        type: 'twitter:post_message',
        memoryZone: 'twitter:post',
        data: {
          text: data.text,
          replyId: data.replyToTweetId ?? null,
        } as TwitterClientInput,
      });

      const currentTime = new Date().toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
      });

      if (data.replyToTweetId) {
        return `${currentTime} ツイート ${data.replyToTweetId} に返信しました: ${data.text}`;
      }
      return `${currentTime} ツイートを投稿しました: ${data.text}`;
    } catch (error) {
      return `ツイート投稿エラー: ${error}`;
    }
  }
}

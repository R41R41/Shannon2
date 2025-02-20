import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { getEventBus } from '../../eventBus/index.js';
import { EventBus } from '../../eventBus/eventBus.js';

export default class ChatOnWebTool extends StructuredTool {
  name = 'chat-on-web';
  description = 'ShannonUIにチャットを送信するツール。';
  schema = z.object({
    message: z.string().describe('送信したいメッセージ'),
  });
  private eventBus: EventBus;

  constructor() {
    super();
    this.eventBus = getEventBus();
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      this.eventBus.publish({
        type: 'web:post_message',
        memoryZone: 'web',
        data: {
          type: 'text',
          text: data.message,
        },
        targetMemoryZones: ['web'],
      });
      const currentTime = new Date().toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
      });
      return `${currentTime} ShannonUIに「${data.message}」というメッセージを送信しました。`;
    } catch (error) {
      console.error('Bing search error:', error);
      return `検索中にエラーが発生しました: ${error}`;
    }
  }
}

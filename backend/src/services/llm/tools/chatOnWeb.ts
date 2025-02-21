import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { getEventBus } from '../../eventBus/index.js';
import { EventBus } from '../../eventBus/eventBus.js';

export default class ChatOnWebTool extends StructuredTool {
  name = 'chat-on-web';
  description = 'A tool to send chat messages to ShannonUI.';
  schema = z.object({
    message: z.string().describe('Message to send'),
  });
  private eventBus: EventBus;

  constructor() {
    super();
    this.eventBus = getEventBus();
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      console.log('chat-on-web', data);
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
      return `${currentTime} Sent a message to ShannonUI: ${data.message}`;
    } catch (error) {
      console.error('Bing search error:', error);
      return `An error occurred while searching: ${error}`;
    }
  }
}

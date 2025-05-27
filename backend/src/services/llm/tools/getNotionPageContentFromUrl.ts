import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { getEventBus } from '../../eventBus/index.js';
import { EventBus } from '../../eventBus/eventBus.js';
import {
    NotionClientInput,
    NotionClientOutput,
} from '@shannon/common';

export default class GetNotionPageContentFromUrlTool extends StructuredTool {
    name = 'get-notion-page-content-from-url';
    description = 'NotionのページURLからタイトルと内容を取得するツール。';
    schema = z.object({
        url: z
            .string()
            .describe('取得したいNotionのページのURL。有効なURLを指定してください。'),
    });
    private eventBus: EventBus;

    constructor() {
        super();
        this.eventBus = getEventBus();
    }

    private toUuid(id: string): string {
        if (id.includes('-')) return id;
        return [
            id.substring(0, 8),
            id.substring(8, 12),
            id.substring(12, 16),
            id.substring(16, 20),
            id.substring(20)
        ].join('-');
    }

    async _call(data: z.infer<typeof this.schema>): Promise<string> {
        try {
            const url = data.url;
            if (!url.includes('https://www.notion.so/')) {
                return 'NotionのページURLを指定してください。';
            }
            const pageId = url.replace('https://www.notion.so/', '');

            console.log('get-notion-page-content-from-url', pageId);
            // emojiIdを取得するPromiseを作成
            const getContent = new Promise<NotionClientOutput>(async (resolve) => {
                this.eventBus.subscribe('tool:getPageMarkdown', (event) => {
                    const { title, content } = event.data as NotionClientOutput;
                    resolve({ title, content });
                });
                await this.eventBus.publish({
                    type: 'notion:getPageMarkdown',
                    memoryZone: 'notion',
                    data: {
                        pageId: pageId,
                    } as NotionClientInput,
                    targetMemoryZones: ['notion'],
                });
            });
            const response = await getContent;
            return `Notionのページからコンテンツを取得しました。${JSON.stringify(response)} `;
        } catch (error) {
            console.error('get-notion-page-content-from-url error:', error);
            return `An error occurred while getting content from Notion: ${error}`;
        }
    }
} 
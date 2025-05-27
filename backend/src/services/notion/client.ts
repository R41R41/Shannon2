import { NotionClientInput } from '@shannon/common';
import dotenv from 'dotenv';
import { Client } from "@notionhq/client";
import { BaseClient } from '../common/BaseClient.js';
import { getEventBus } from '../eventBus/index.js';

dotenv.config();

export class NotionClient extends BaseClient {
    private client: Client;
    private myUserId: string | null = null;
    public isTest: boolean = false;

    private static instance: NotionClient;

    public static getInstance(isTest: boolean = false) {
        const eventBus = getEventBus();
        if (!NotionClient.instance) {
            NotionClient.instance = new NotionClient('notion', isTest);
        }
        NotionClient.instance.isTest = isTest;
        NotionClient.instance.myUserId = process.env.TWITTER_USER_ID || null;
        return NotionClient.instance;
    }

    private constructor(serviceName: 'notion', isTest: boolean) {
        const eventBus = getEventBus();
        super(serviceName, eventBus);
        const apiKey = process.env.NOTION_API_KEY;

        if (!apiKey) {
            throw new Error('Notion APIの認証情報が設定されていません');
        }

        this.client = new Client({ auth: apiKey });
    }

    private setupEventHandlers() {
        this.eventBus.subscribe('notion:status', async (event) => {
            const { serviceCommand } = event.data as NotionClientInput;
            if (serviceCommand === 'start') {
                await this.start();
            } else if (serviceCommand === 'stop') {
                await this.stop();
            } else if (serviceCommand === 'status') {
                this.eventBus.publish({
                    type: 'web:status',
                    memoryZone: 'web',
                    data: {
                        service: 'notion',
                        status: this.status,
                    },
                });
            }
        });
        this.eventBus.subscribe('notion:getPageMarkdown', async (event) => {
            const { pageId } = event.data as NotionClientInput;
            const markdown = await this.getPageBlocksToMarkdown(pageId);
            const title = await this.getPageTitle(pageId);
            this.eventBus.publish({
                type: 'tool:getPageMarkdown',
                memoryZone: 'notion',
                data: {
                    title: title,
                    content: markdown,
                },
            });
        });
    }

    async getPageTitle(pageId: string) {
        const response = await this.client.pages.properties.retrieve({ page_id: pageId, property_id: "title" });
        // @ts-ignore
        const title = response?.results?.[0]?.title?.plain_text
            // @ts-ignore
            || response?.property_item?.title?.plain_text
            || '';
        return title;
    }

    async getPageBlocksToMarkdown(pageId: string) {
        console.log('\x1b[34mgetPageBlocksToMarkdown\x1b[0m', pageId);
        try {
            const response = await this.client.blocks.children.list({
                block_id: pageId,
            });

            const markdown = response.results.map((block) => {
                let content = "";
                // ブロックタイプに基づいてマークダウン形式のコンテンツを生成
                // @ts-ignore
                if (block.type === "paragraph") {
                    // @ts-ignore
                    const richText = block.paragraph?.rich_text?.[0];
                    content = richText?.text?.content || "";
                    // @ts-ignore
                } else if (block.type === "heading_1") {
                    // @ts-ignore
                    const richText = block.heading_1?.rich_text?.[0];
                    content = `# ${richText?.text?.content || ""}`;
                    // @ts-ignore
                } else if (block.type === "heading_2") {
                    // @ts-ignore
                    const richText = block.heading_2?.rich_text?.[0];
                    content = `## ${richText?.text?.content || ""}`;
                    // @ts-ignore
                } else if (block.type === "heading_3") {
                    // @ts-ignore
                    const richText = block.heading_3?.rich_text?.[0];
                    content = `### ${richText?.text?.content || ""}`;
                    // @ts-ignore
                } else if (block.type === "bulleted_list_item") {
                    // @ts-ignore
                    const richText = block.bulleted_list_item?.rich_text?.[0];
                    content = `- ${richText?.text?.content || ""}`;
                    // @ts-ignore
                } else if (block.type === "numbered_list_item") {
                    // @ts-ignore
                    const richText = block.numbered_list_item?.rich_text?.[0];
                    content = `1. ${richText?.text?.content || ""}`;
                    // @ts-ignore
                } else if (block.type === "to_do") {
                    // @ts-ignore
                    const richText = block.to_do?.rich_text?.[0];
                    // @ts-ignore
                    const checked = block.to_do?.checked;
                    content = `- [${checked ? 'x' : ' '}] ${richText?.text?.content || ""}`;
                    // @ts-ignore
                } else if (block.type === "code") {
                    // @ts-ignore
                    const richText = block.code?.rich_text?.[0];
                    // @ts-ignore
                    const language = block.code?.language || "";
                    content = `\`\`\`${language}\n${richText?.text?.content || ""}\n\`\`\``;
                }

                return content;
            });
            return markdown;
        } catch (error) {
            console.error(`Notionブロック取得エラー: ${error}`);
            return [];
        }
    }

    public async initialize() {
        try {
            this.setupEventHandlers();
        } catch (error) {
            if (error instanceof Error && error.message.includes('429')) {
                const apiError = error as any;
                if (apiError.rateLimit?.reset) {
                    const resetTime = apiError.rateLimit.reset * 1000;
                    const now = Date.now();
                    const waitTime = resetTime - now + 10000;

                    console.warn(
                        `\x1b[33mTwitter rate limit reached, waiting until ${new Date(
                            resetTime
                        ).toISOString()} (${waitTime / 1000}s)\x1b[0m`
                    );

                    await new Promise((resolve) => setTimeout(resolve, waitTime));
                    await this.initialize();
                } else {
                    console.warn(
                        '\x1b[33mTwitter rate limit reached, waiting before retry...\x1b[0m'
                    );
                    await new Promise((resolve) => setTimeout(resolve, 5000));
                    await this.initialize();
                }
            } else {
                console.error(`\x1b[31mNotion initialization error: ${error}\x1b[0m`);
                throw error;
            }
        }
    }
}

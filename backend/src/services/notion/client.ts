import { Client } from "@notionhq/client";
import type { BlockObjectResponse, RichTextItemResponse } from "@notionhq/client/build/src/api-endpoints";
import { NotionClientInput } from '@shannon/common';
import { BaseClient } from '../common/BaseClient.js';
import { getEventBus } from '../eventBus/index.js';
import { config } from '../../config/env.js';

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
        NotionClient.instance.myUserId = config.twitter.userId || null;
        return NotionClient.instance;
    }

    private constructor(serviceName: 'notion', isTest: boolean) {
        const eventBus = getEventBus();
        super(serviceName, eventBus);
        const apiKey = config.notion.apiKey;

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

    /**
     * リッチテキストからプレーンテキストを抽出
     */
    private extractRichText(richTextArray: RichTextItemResponse[]): string {
        if (!richTextArray || !Array.isArray(richTextArray)) return "";
        return richTextArray.map(rt => ('text' in rt ? rt.text.content : null) || rt.plain_text || "").join("");
    }

    /**
     * 画像ブロックからURLを取得
     */
    private getImageUrl(imageBlock: Extract<BlockObjectResponse, { type: 'image' }>): string | null {
        const imageData = imageBlock.image;
        if (!imageData) return null;

        if (imageData.type === 'file') {
            return imageData.file?.url || null;
        } else if (imageData.type === 'external') {
            return imageData.external?.url || null;
        }
        return null;
    }

    /**
     * ブロックをマークダウンに変換
     */
    private blockToMarkdown(block: BlockObjectResponse, indent: number = 0): string {
        const indentStr = "  ".repeat(indent);
        let content = "";

        if (block.type === "paragraph") {
            content = this.extractRichText(block.paragraph.rich_text);
        } else if (block.type === "heading_1") {
            content = `# ${this.extractRichText(block.heading_1.rich_text)}`;
        } else if (block.type === "heading_2") {
            content = `## ${this.extractRichText(block.heading_2.rich_text)}`;
        } else if (block.type === "heading_3") {
            content = `### ${this.extractRichText(block.heading_3.rich_text)}`;
        } else if (block.type === "bulleted_list_item") {
            content = `${indentStr}- ${this.extractRichText(block.bulleted_list_item.rich_text)}`;
        } else if (block.type === "numbered_list_item") {
            content = `${indentStr}1. ${this.extractRichText(block.numbered_list_item.rich_text)}`;
        } else if (block.type === "to_do") {
            const checked = block.to_do.checked;
            content = `${indentStr}- [${checked ? 'x' : ' '}] ${this.extractRichText(block.to_do.rich_text)}`;
        } else if (block.type === "toggle") {
            content = `${indentStr}▶ ${this.extractRichText(block.toggle.rich_text)}`;
        } else if (block.type === "code") {
            const language = block.code.language || "";
            content = `\`\`\`${language}\n${this.extractRichText(block.code.rich_text)}\n\`\`\``;
        } else if (block.type === "quote") {
            content = `> ${this.extractRichText(block.quote.rich_text)}`;
        } else if (block.type === "callout") {
            const icon = (block.callout.icon?.type === 'emoji' ? block.callout.icon.emoji : null) || "💡";
            content = `${icon} ${this.extractRichText(block.callout.rich_text)}`;
        } else if (block.type === "divider") {
            content = "---";
        } else if (block.type === "table_row") {
            const cells = block.table_row.cells;
            content = `| ${cells.map((cell: RichTextItemResponse[]) => this.extractRichText(cell)).join(" | ")} |`;
        } else if (block.type === "image") {
            // 画像ブロック: URLを返す（内容分析はdescribe-imageツールで行う）
            const imageUrl = this.getImageUrl(block);
            const caption = this.extractRichText(block.image.caption);
            if (imageUrl) {
                content = `📷 [画像${caption ? `: ${caption}` : ''}] URL: ${imageUrl}`;
            } else {
                content = "📷 [画像: URLを取得できませんでした]";
            }
        } else if (block.type === "file") {
            // ファイルブロック
            const fileData = block.file;
            const fileUrl = (fileData.type === 'file' ? fileData.file.url : fileData.external.url) || "";
            const fileName = block.file.name || "添付ファイル";
            content = `📎 [ファイル: ${fileName}] URL: ${fileUrl}`;
        } else if (block.type === "pdf") {
            // PDFブロック
            const pdfData = block.pdf;
            const pdfUrl = (pdfData.type === 'file' ? pdfData.file.url : pdfData.external.url) || "";
            content = `📄 [PDF] URL: ${pdfUrl}`;
        } else if (block.type === "video") {
            // ビデオブロック
            const videoData = block.video;
            const videoUrl = (videoData.type === 'external' ? videoData.external.url : videoData.type === 'file' ? videoData.file.url : "") || "";
            content = `🎥 [動画] URL: ${videoUrl}`;
        } else if (block.type === "embed") {
            // 埋め込みブロック
            const url = block.embed.url || "";
            content = `🔗 [埋め込み] URL: ${url}`;
        } else if (block.type === "bookmark") {
            // ブックマークブロック
            const url = block.bookmark.url || "";
            content = `🔗 [埋め込み] URL: ${url}`;
        }

        return content;
    }

    /**
     * 再帰的にブロックとその子ブロックを取得してマークダウンに変換
     */
    async getPageBlocksToMarkdown(pageId: string, indent: number = 0): Promise<string[]> {
        console.log('\x1b[34mgetPageBlocksToMarkdown\x1b[0m', pageId);
        try {
            const response = await this.client.blocks.children.list({
                block_id: pageId,
            });

            const markdownLines: string[] = [];

            for (const block of response.results) {
                // Skip PartialBlockObjectResponse (lacks 'type' field)
                if (!('type' in block)) continue;

                const content = this.blockToMarkdown(block, indent);
                if (content) {
                    markdownLines.push(content);
                }

                // 子ブロックがある場合は再帰的に取得
                if (block.has_children) {
                    const childMarkdown = await this.getPageBlocksToMarkdown(block.id, indent + 1);
                    markdownLines.push(...childMarkdown);
                }
            }

            return markdownLines;
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
                const apiError = error as Error & { rateLimit?: { reset?: number } };
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

import { StructuredTool } from '@langchain/core/tools';
import {
    NotionClientInput,
    NotionClientOutput,
} from '@shannon/common';
import { z } from 'zod';
import { EventBus } from '../../eventBus/eventBus.js';
import { getEventBus } from '../../eventBus/index.js';
import { cacheNotionImageUrls } from './describeNotionImage.js';

export default class GetNotionPageContentFromUrlTool extends StructuredTool {
    name = 'get-notion-page-content-from-url';
    description = 'NotionのページまたはデータベースのURLからタイトルと内容を取得するツール。通常のページもデータベース（カレンダーやテーブル等）も対応。';
    schema = z.object({
        url: z
            .string()
            .describe('取得したいNotionのページまたはデータベースのURL。有効なURLを指定してください。'),
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

    /**
     * S3 URLからファイル名を抽出（短縮表示用）
     */
    private extractFileName(url: string): string {
        try {
            // URLからパス部分を取得
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            // 最後のパス部分（ファイル名）を取得
            const parts = pathname.split('/');
            const fileName = parts[parts.length - 1];
            // デコードして読みやすく
            const decoded = decodeURIComponent(fileName);
            // 長すぎる場合は短縮
            if (decoded.length > 40) {
                return decoded.substring(0, 37) + '...';
            }
            return decoded;
        } catch {
            return '(ファイル名取得不可)';
        }
    }

    /**
     * NotionのURLからページIDを抽出する
     * URL形式: https://www.notion.so/[workspace/]title-slug-2bcffc09dab28024b6b6e486fa545e66
     * UUIDは最後の32文字（ハイフンなし）
     */
    private extractPageId(url: string): string | null {
        // URLの最後の部分を取得
        const parts = url.split('/');
        const lastPart = parts[parts.length - 1];

        // クエリパラメータを除去
        const pathPart = lastPart.split('?')[0];

        // 最後の32文字がUUID（ハイフンなしの場合）
        // または最後の36文字がUUID（ハイフンありの場合）
        const match = pathPart.match(/([a-f0-9]{32})$/i) || pathPart.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i);

        if (match) {
            return match[1];
        }

        return null;
    }

    async _call(data: z.infer<typeof this.schema>): Promise<string> {
        try {
            const url = data.url;
            if (!url.includes('notion.so/')) {
                return 'NotionのページURLを指定してください。';
            }

            const pageId = this.extractPageId(url);
            if (!pageId) {
                return `NotionのURLからページIDを抽出できませんでした: ${url}`;
            }

            console.log('get-notion-page-content-from-url', pageId);
            // Notionクライアントにイベント経由でリクエストし、レスポンスを待つ
            const getContent = new Promise<NotionClientOutput>((resolve, reject) => {
                // タイムアウト: 30秒
                const timeout = setTimeout(() => {
                    reject(new Error('Notionからの応答がタイムアウトしました（30秒）'));
                }, 30000);

                this.eventBus.subscribe('tool:getPageMarkdown', (event) => {
                    clearTimeout(timeout);
                    const { title, content } = event.data as NotionClientOutput;
                    resolve({ title, content });
                });
                this.eventBus.publish({
                    type: 'notion:getPageMarkdown',
                    memoryZone: 'notion',
                    data: {
                        pageId: pageId,
                    } as NotionClientInput,
                    targetMemoryZones: ['notion'],
                });
            });
            const response = await getContent;
            const contentArray = Array.isArray(response.content) ? response.content : [response.content];

            // 画像URLを抽出して番号付きリストにまとめる
            const imageUrls: { index: number; caption: string; url: string }[] = [];
            const processedContent: string[] = [];

            for (const line of contentArray) {
                // 画像行を検出: 📷 [画像: caption] URL: https://...
                const imageMatch = line.match(/📷 \[画像(?:: ([^\]]*))?\] URL: (.+)/);
                if (imageMatch) {
                    const caption = imageMatch[1] || '';
                    const url = imageMatch[2];
                    const index = imageUrls.length + 1;
                    imageUrls.push({ index, caption, url });
                    // 本文中は番号だけにして短縮
                    processedContent.push(`📷 [画像${index}${caption ? `: ${caption}` : ''}]`);
                } else {
                    processedContent.push(line);
                }
            }

            let result = `Notionのページからコンテンツを取得しました。\n\nタイトル: ${response.title}\n\n内容:\n${processedContent.join('\n')}`;

            if (imageUrls.length > 0) {
                // 画像URLをキャッシュに保存（describe-notion-imageツールで使用）
                cacheNotionImageUrls(imageUrls.map(img => img.url));

                result += `\n\n━━━━━━━━━━━━━━━━━━━━\n`;
                result += `📷 画像一覧（${imageUrls.length}件）- URLはキャッシュ済み\n`;
                result += `━━━━━━━━━━━━━━━━━━━━\n`;
                for (const img of imageUrls) {
                    // URLを短縮表示（ファイル名部分のみ）
                    const fileName = this.extractFileName(img.url);
                    result += `[画像${img.index}] ${fileName}\n`;
                }
                result += `\n🚨 **重要**: describe-notion-image ツールを使って、すべての画像を分析してください。`;
                result += `\n例: describe-notion-image(image_number: 1), describe-notion-image(image_number: 2)...`;
                result += `\n画像を分析せずにユーザーに報告しないでください。`;
            }

            return result;
        } catch (error) {
            console.error('get-notion-page-content-from-url error:', error);
            return `An error occurred while getting content from Notion: ${error}`;
        }
    }
} 
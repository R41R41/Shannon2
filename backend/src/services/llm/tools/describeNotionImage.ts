import { StructuredTool } from '@langchain/core/tools';
import OpenAI from 'openai';
import { z } from 'zod';
import { config } from '../../../config/env.js';
import { models } from '../../../config/models.js';

// 画像URLキャッシュ（グローバル）
const imageUrlCache: Map<number, string> = new Map();

/**
 * 画像URLをキャッシュに保存
 */
export function cacheNotionImageUrls(urls: string[]): void {
    imageUrlCache.clear();
    urls.forEach((url, index) => {
        imageUrlCache.set(index + 1, url); // 1-indexed
    });
    console.log(`\x1b[35m📷 ${urls.length}件の画像URLをキャッシュしました\x1b[0m`);
}

/**
 * キャッシュから画像URLを取得
 */
export function getNotionImageUrl(imageNumber: number): string | null {
    return imageUrlCache.get(imageNumber) || null;
}

/**
 * キャッシュをクリア
 */
export function clearNotionImageCache(): void {
    imageUrlCache.clear();
}

export default class DescribeNotionImageTool extends StructuredTool {
    name = 'describe-notion-image';
    description =
        'Notionページ内の画像を番号で指定して分析するツール。get-notion-page-content-from-urlで取得した画像番号（[画像1]、[画像2]など）を指定してください。';
    schema = z.object({
        image_number: z
            .number()
            .describe('分析したい画像の番号（1, 2, 3...）'),
    });
    private openai: OpenAI;

    constructor() {
        super();
        const openaiApiKey = config.openaiApiKey;
        if (!openaiApiKey) {
            throw new Error('OPENAI_API_KEY environment variable is not set.');
        }
        this.openai = new OpenAI({ apiKey: openaiApiKey });
    }

    async _call(data: z.infer<typeof this.schema>): Promise<string> {
        try {
            const imageUrl = getNotionImageUrl(data.image_number);

            if (!imageUrl) {
                const cachedNumbers = Array.from(imageUrlCache.keys()).sort((a, b) => a - b);
                if (cachedNumbers.length === 0) {
                    return `画像キャッシュが空です。先にget-notion-page-content-from-urlでNotionページを取得してください。`;
                }
                return `画像${data.image_number}が見つかりません。利用可能な画像番号: ${cachedNumbers.join(', ')}`;
            }

            console.log(`\x1b[35m📷 画像${data.image_number}を分析中...\x1b[0m`);

            const response = await this.openai.chat.completions.create({
                model: models.vision,
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: 'この画像を日本語で説明してください。テキストが含まれる場合は、内容も記載してください。',
                            },
                            {
                                type: 'image_url',
                                image_url: { url: imageUrl },
                            },
                        ],
                    },
                ],
                max_completion_tokens: 300,
            });

            const description = response.choices[0].message.content || '画像の分析に失敗しました';
            return `[画像${data.image_number}の説明] ${description}`;
        } catch (error) {
            console.error('Notion image description error:', error);
            return `画像${data.image_number}の分析中にエラーが発生しました: ${error}`;
        }
    }
}


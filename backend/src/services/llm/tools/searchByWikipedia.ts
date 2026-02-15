import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import wikipedia from 'wikipedia';

// Wikipedia API は User-Agent 必須（ないと 403）
wikipedia.setUserAgent('ShannonBot/1.0 (https://sh4nnon.com)');

export default class SearchByWikipediaTool extends StructuredTool {
    name = 'search-by-wikipedia';
    description = 'Wikipediaで対象を検索し、内容を返すツール。日本語・英語どちらも対応。';
    schema = z.object({
        query: z.string().describe('Wikipediaで検索したい内容（日本語も可）'),
        lang: z.string().optional().describe('検索言語（例: "ja" または "en"。省略時はja)'),
        summary: z.boolean().optional().describe('要約を返すかどうか（省略時はfalse）'),
    });

    constructor() {
        super();
    }

    async _call(data: z.infer<typeof this.schema>): Promise<string> {
        try {
            const lang = data.lang || 'ja';
            wikipedia.setLang(lang);
            const page = await wikipedia.page(data.query);
            if (data.summary) {
                const summary = await page.summary();
                return summary.extract;
            } else {
                const content = await page.content();
                return content;
            }
        } catch (error: any) {
            if (error && error.message && error.message.includes('No article found')) {
                return `Wikipediaで「${data.query}」の記事が見つかりませんでした。`;
            }
            console.error('Wikipedia search error:', error);
            return `Wikipedia検索中にエラーが発生しました: ${error}`;
        }
    }
}

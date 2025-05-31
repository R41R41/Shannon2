import { describe, it, expect } from 'vitest';
import GoogleSearchTool from '../../../../src/services/llm/tools/googleSearch';

describe('Google検索ツール', () => {
    const tool = new GoogleSearchTool();

    it('シンプルなクエリで結果が返ること', async () => {
        const result = await tool._call({ query: 'OpenAI' });
        console.log(result);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('siteSearchパラメータで特定ドメイン内検索ができること', async () => {
        const result = await tool._call({ query: 'AI', siteSearch: 'asahi.com' });
        console.log(result);
        expect(typeof result).toBe('string');
    });

    it('dateRestrictパラメータで日付絞り込みができること', async () => {
        const result = await tool._call({ query: 'AI', dateRestrict: 'w1' });
        console.log(result);
        expect(typeof result).toBe('string');
    });

    it('gl, lrパラメータで日本語・日本地域の検索ができること', async () => {
        const result = await tool._call({ query: 'AI', gl: 'jp', lr: 'lang_ja' });
        console.log(result);
        expect(typeof result).toBe('string');
    });

    it('存在しないクエリで"No results found."が返ること', async () => {
        const result = await tool._call({ query: 'asdkfjhasdkjfhqweoiruqwpeoriuqwpeoriuqwpeoriuqwpeoriu' });
        console.log(result);
        expect(result).toBe('No results found.');
    });
});

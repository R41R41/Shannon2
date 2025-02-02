import { BingSerpAPI } from '@langchain/community/tools/bingserpapi';
import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

export default class BingSearchTool extends StructuredTool {
  name = 'bing-search';
  description =
    'bing検索ツール。最終的な応答には必ずどのサイトを調べたのかソースを含めてください。';
  schema = z.object({
    query: z.string().describe('検索したい内容（検索内容に適した言語で指定）'),
  });
  private bingSerpAPI: BingSerpAPI;

  constructor() {
    super();
    const bingSubscriptionKey = process.env.BING_SUBSCRIPTION_KEY;
    if (!bingSubscriptionKey) {
      throw new Error('BING_SUBSCRIPTION_KEY environment variable is not set.');
    }

    this.bingSerpAPI = new BingSerpAPI(bingSubscriptionKey, {
      location: 'Japan',
      hl: 'ja',
      gl: 'jp',
    });
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      return await this.bingSerpAPI.invoke(data.query);
    } catch (error) {
      console.error('Bing search error:', error);
      return `検索中にエラーが発生しました: ${error}`;
    }
  }
}

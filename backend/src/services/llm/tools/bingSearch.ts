import { BingSerpAPI } from '@langchain/community/tools/bingserpapi';
import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

export default class BingSearchTool extends StructuredTool {
  name = 'bing-search';
  description =
    'A bing search tool. Always include the source of the final response.';
  schema = z.object({
    query: z
      .string()
      .describe(
        'The content you want to search for (specify in the language appropriate for the search content)'
      ),
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
      return `An error occurred while searching: ${error}`;
    }
  }
}

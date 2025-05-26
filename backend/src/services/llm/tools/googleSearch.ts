import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

export default class GoogleSearchTool extends StructuredTool {
  name = 'google-search';
  description = 'A Google search tool using Custom Search JSON API.';
  schema = z.object({
    query: z.string().describe('The content you want to search for'),
    dateRestrict: z.string().optional().describe('Restrict results to a specific date range (e.g., "d1", "w1", "m1", "y1")'),
  });

  private apiKey: string;
  private searchEngineId: string;

  constructor() {
    super();
    this.apiKey = process.env.GOOGLE_API_KEY || '';
    this.searchEngineId = process.env.SEARCH_ENGINE_ID || '';

    if (!this.apiKey || !this.searchEngineId) {
      throw new Error('API key or Search Engine ID is not set in environment variables.');
    }
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    let url = `https://www.googleapis.com/customsearch/v1?key=${this.apiKey}&cx=${this.searchEngineId}&q=${encodeURIComponent(data.query)}`;

    if (data.dateRestrict) {
      url += `&dateRestrict=${data.dateRestrict}`;
    }

    try {
      const response = await fetch(url);
      const result = await response.json();

      if (result.items && result.items.length > 0) {
        return result.items.map((item: any) => item.title).join(', ');
      } else {
        return 'No results found.';
      }
    } catch (error) {
      console.error('Google search error:', error);
      return `An error occurred while searching: ${error}`;
    }
  }
}

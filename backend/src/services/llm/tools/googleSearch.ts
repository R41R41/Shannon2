import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

export default class GoogleSearchTool extends StructuredTool {
  name = 'google-search';
  description = 'A Google search tool using Custom Search JSON API. Supports query, dateRestrict, siteSearch, num, start, sort, filter, gl, lr.';
  schema = z.object({
    query: z.string().describe('The content you want to search for'),
    dateRestrict: z.string().optional().describe('Restrict results to a specific date range (e.g., "d1", "w1", "m1", "y1")'),
    siteSearch: z.string().optional().describe('Restrict search to a specific domain (e.g., "asahi.com")'),
    num: z.number().optional().describe('Number of results to return (max 10)'),
    start: z.number().optional().describe('The index of the first result to return (for paging)'),
    sort: z.string().optional().describe('The order to sort results (CSE setting dependent)'),
    filter: z.string().optional().describe('Duplicate content filter ("0" to disable)'),
    gl: z.string().optional().describe('Geolocation country code (e.g., "jp")'),
    lr: z.string().optional().describe('Language restrict (e.g., "lang_ja")'),
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

    if (data.dateRestrict) url += `&dateRestrict=${data.dateRestrict}`;
    if (data.siteSearch) url += `&siteSearch=${encodeURIComponent(data.siteSearch)}`;
    if (data.num) url += `&num=${data.num}`;
    if (data.start) url += `&start=${data.start}`;
    if (data.sort) url += `&sort=${encodeURIComponent(data.sort)}`;
    if (data.filter) url += `&filter=${encodeURIComponent(data.filter)}`;
    if (data.gl) url += `&gl=${encodeURIComponent(data.gl)}`;
    if (data.lr) url += `&lr=${encodeURIComponent(data.lr)}`;

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

import { GoogleSearchAPIWrapper } from '@langchain/community/tools/googlesearchapiwrapper';
import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

export default class GoogleSearchTool extends StructuredTool {
  name = 'google-search';
  description =
    'A Google search tool. Always include the source of the final response.';
  schema = z.object({
    query: z
      .string()
      .describe(
        'The content you want to search for (specify in the language appropriate for the search content)'
      ),
  });
  private googleSearchAPI: GoogleSearchAPIWrapper;

  constructor() {
    super();
    const googleApiKey = process.env.GOOGLE_API_KEY;
    if (!googleApiKey) {
      throw new Error('GOOGLE_API_KEY environment variable is not set.');
    }

    this.googleSearchAPI = new GoogleSearchAPIWrapper(googleApiKey);
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      return await this.googleSearchAPI.invoke(data.query);
    } catch (error) {
      console.error('Google search error:', error);
      return `An error occurred while searching: ${error}`;
    }
  }
}

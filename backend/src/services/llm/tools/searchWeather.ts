import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

export default class SearchWeatherTool extends StructuredTool {
  name = 'search-weather';
  description =
    'A weather search tool. Use this tool when you need to check the weather.';
  schema = z.object({
    date: z.string().describe('The date you want to search for (YYYY-MM-DD)'),
    location: z.string().describe('The location you want to search for'),
  });

  constructor() {
    super();
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      return `Use the bing-search tool to search for the weather in ${data.location} on ${data.date}, and return it in the following format.\n
      ${data.date}の${data.location}の天気は～～～です。
      気温:△△-△△℃
      降水確率:△△-△△%
      天気の詳しい説明と、気の利いた一言`;
    } catch (error) {
      console.error('Weather search tool error:', error);
      return `An error occurred: ${error}`;
    }
  }
}

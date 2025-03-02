import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const WolframAlphaAPI = require('@wolfram-alpha/wolfram-alpha-api');

export default class WolframAlphaTool extends StructuredTool {
  name = 'wolfram-alpha-tool';
  description =
    'A versatile knowledge tool that answers science and data-based questions including mathematical calculations, physics, chemistry, astronomy, geography, finance and more';
  schema = z.object({
    query: z
      .string()
      .describe(
        'English question content (example: 2x + 3 = 7 solution, Mount Fuji height, 2024 Olympic gold medal count, Tokyo to Osaka distance, stock price data, nutrition calculation, next holiday, sunrise/sunset time, etc.)'
      ),
  });
  private wolframClient: any;

  constructor() {
    super();
    const wolframAppId = process.env.WOLFRAM_ALPHA_APPID;
    if (!wolframAppId) {
      throw new Error('WOLFRAM_ALPHA_APPID environment variable is not set.');
    }

    this.wolframClient = WolframAlphaAPI(wolframAppId);
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      const result = await this.wolframClient.getFull({
        input: data.query,
        format: 'plaintext',
      });
      if (typeof result === 'object') {
        return JSON.stringify(result);
      }
      return result || 'No answer found.';
    } catch (error) {
      console.error('Wolfram Alpha error:', error);
      return `An error occurred during calculation: ${error}`;
    }
  }
}

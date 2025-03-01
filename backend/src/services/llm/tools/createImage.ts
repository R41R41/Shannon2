import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import OpenAI from 'openai';

export default class CreateImageTool extends StructuredTool {
  name = 'create-image';
  description =
    'A tool to create an image from a text description. Use this when you need to create an image.';
  schema = z.object({
    text: z
      .string()
      .describe('The text description of the image you want to create'),
  });
  private openai: OpenAI;

  constructor() {
    super();
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set.');
    }
    this.openai = new OpenAI({ apiKey: openaiApiKey });
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      const response = await this.openai.images.generate({
        model: 'dall-e-3',
        prompt: data.text,
        n: 1,
        size: '1024x1024',
      });

      return `Image created url: ${response.data[0].url}`;
    } catch (error) {
      console.error('Image description error:', error);
      return `An error occurred while analyzing the image: ${error}`;
    }
  }
}

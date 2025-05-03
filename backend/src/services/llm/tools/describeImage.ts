import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import OpenAI from 'openai';

export default class DescribeImageTool extends StructuredTool {
  name = 'describe-image';
  description =
    'A tool to analyze and describe the content of images from URLs. Use this when you need to understand what is in an image.';
  schema = z.object({
    image_url: z
      .string()
      .url()
      .describe('The URL of the image you want to analyze'),
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
      const response = await this.openai.chat.completions.create({
        model: 'gpt-o4-mini',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Please describe the image in detail.' },
              {
                type: 'image_url',
                image_url: {
                  url: data.image_url,
                },
              },
            ],
          },
        ],
        max_tokens: 300,
      });

      return (
        response.choices[0].message.content || 'Failed to analyze the image.'
      );
    } catch (error) {
      console.error('Image description error:', error);
      return `An error occurred while analyzing the image: ${error}`;
    }
  }
}

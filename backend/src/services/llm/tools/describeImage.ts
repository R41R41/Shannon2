import { StructuredTool } from '@langchain/core/tools';
import OpenAI from 'openai';
import fs from 'fs';
import { z } from 'zod';
import { config } from '../../../config/env.js';
import { models } from '../../../config/models.js';

export default class DescribeImageTool extends StructuredTool {
  name = 'describe-image';
  description =
    '画像の内容を分析・説明するツール。URLまたはローカルファイルパスを受け付ける。get-discord-images で取得したURLをそのまま渡せる。';
  schema = z.object({
    image_url: z
      .string()
      .describe('画像のURL、またはローカルファイルパス'),
  });
  private openai: OpenAI;

  constructor() {
    super();
    const openaiApiKey = config.openaiApiKey;
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set.');
    }
    this.openai = new OpenAI({ apiKey: openaiApiKey });
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      // ローカルファイルパスの場合は base64 に変換
      let imageUrl = data.image_url;
      if (imageUrl.startsWith('/') || imageUrl.startsWith('./') || imageUrl.startsWith('../')) {
        if (!fs.existsSync(imageUrl)) {
          return `エラー: 画像ファイルが見つかりません: ${imageUrl}`;
        }
        const imageBuffer = fs.readFileSync(imageUrl);
        const base64 = imageBuffer.toString('base64');
        imageUrl = `data:image/png;base64,${base64}`;
      }

      const response = await this.openai.chat.completions.create({
        model: models.vision,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'この画像を日本語で説明してください。テキストが含まれる場合は、ひらがなの部分はひらがなで、漢字の部分は漢字で表記してください。' },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl,
                },
              },
            ],
          },
        ],
        max_tokens: 300,
      });

      const choice = response.choices[0];
      console.log(`🖼️ describe-image response: finish_reason=${choice.finish_reason}, content_length=${choice.message.content?.length ?? 'null'}, refusal=${(choice.message as any).refusal ?? 'none'}`);

      if (!choice.message.content) {
        console.warn('🖼️ describe-image: empty content. Full response:', JSON.stringify(choice, null, 2));
      }

      return (
        choice.message.content || 'Failed to analyze the image.'
      );
    } catch (error) {
      console.error('Image description error:', error);
      return `An error occurred while analyzing the image: ${error}`;
    }
  }
}

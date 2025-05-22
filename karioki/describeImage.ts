import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import OpenAI from 'openai';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// imgurアップロード関数
async function uploadToImgur(imagePath: string): Promise<string> {
  const clientId = process.env.IMGUR_CLIENT_ID;
  if (!clientId)
    throw new Error('IMGUR_CLIENT_ID environment variable is not set.');
  const image = fs.readFileSync(imagePath, { encoding: 'base64' });
  const response = await axios.post(
    'https://api.imgur.com/3/image',
    { image },
    { headers: { Authorization: `Client-ID ${clientId}` } }
  );
  return response.data.data.link;
}

export default class DescribeImageTool extends StructuredTool {
  name = 'describe-image';
  description =
    '画像のパスを受け取り、その内容を文脈に沿って分析するツールです。画像の内容を理解する必要があるときに使用してください。';
  schema = z.object({
    image_path: z.string().describe('分析したい画像のパス'),
    context: z
      .string()
      .describe(
        '分析する文脈。例は短いが実際はもっと詳細に指定すること。例:"ここはどのバイオームですか？", "指定した通りに建築できていますか？"'
      ),
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
    let imageUrl = '';
    try {
      imageUrl = await uploadToImgur(data.image_path);
    } catch (e) {
      return `画像のアップロードに失敗しました: ${e}`;
    }
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Context: ${data.context}`,
              },
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

      return (
        response.choices[0].message.content || 'Failed to analyze the image.'
      );
    } catch (error) {
      console.error('Image description error:', error);
      return `An error occurred while analyzing the image: ${error}`;
    }
  }
}

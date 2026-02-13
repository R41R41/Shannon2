import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import OpenAI from 'openai';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
  private outputDir: string;

  constructor() {
    super();
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set.');
    }
    this.openai = new OpenAI({ apiKey: openaiApiKey });

    // 画像保存ディレクトリ
    this.outputDir = join(__dirname, '../../../../saves/images/generated');
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      const response = await this.openai.images.generate({
        model: 'gpt-image-1',
        prompt: data.text,
        n: 1,
        size: '1024x1024',
      });

      // gpt-image-1 はbase64のみ返す（URLは非対応）
      const b64Json = response.data?.[0]?.b64_json;
      if (b64Json) {
        const filename = `img_${Date.now()}.png`;
        const filepath = join(this.outputDir, filename);
        const imageBuffer = Buffer.from(b64Json, 'base64');
        writeFileSync(filepath, imageBuffer);
        console.log(`\x1b[35m🎨 画像生成完了: ${filepath}\x1b[0m`);
        return `Image created and saved to: ${filepath}`;
      }

      // フォールバック: URLがある場合（dall-e系モデルとの互換用）
      const url = response.data?.[0]?.url;
      if (url) {
        return `Image created url: ${url}`;
      }

      return 'Image was generated but no data was returned.';
    } catch (error) {
      console.error('Image generation error:', error);
      return `An error occurred while generating the image: ${error}`;
    }
  }
}

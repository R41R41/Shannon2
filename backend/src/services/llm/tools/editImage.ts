import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { config } from '../../../config/env.js';
import { models } from '../../../config/models.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 既存の画像を編集するツール。
 * URLまたはローカルファイルパスを受け取り、テキスト指示に従って画像を編集する。
 *
 * GPT Image モデル (gpt-image-1, gpt-image-1.5 等) を使用。
 * SDK の images.edit() は multipart/form-data 固定で GPT Image モデル非対応のため、
 * REST API を直接呼び出して JSON 形式 (images 配列) で送信する。
 */
export default class EditImageTool extends StructuredTool {
  name = 'edit-image';
  description =
    '既存の画像を編集するツール。元画像のURLまたはファイルパスと編集指示テキストを渡すと、編集後の画像を生成して保存する。「この画像の○○を△△にして」「背景を変えて」等の画像修正リクエストに使う。まず get-discord-images で画像URLを取得してから、そのURLをimagePath に渡す。';
  schema = z.object({
    imagePath: z
      .string()
      .describe(
        '編集元の画像URL（Discord CDN等）またはローカルファイルパス。get-discord-images で取得したURLをそのまま指定できる',
      ),
    prompt: z
      .string()
      .describe(
        '画像の編集指示。元画像からどう変更したいかを具体的に書く。例: "犬の顔を猫の顔に変更して、それ以外はそのまま維持"',
      ),
  });

  private apiKey: string;
  private outputDir: string;

  constructor() {
    super();
    const openaiApiKey = config.openaiApiKey;
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set.');
    }
    this.apiKey = openaiApiKey;

    this.outputDir = join(__dirname, '../../../../saves/images/generated');
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      // 画像を data URI (base64) に変換
      let imageDataUrl: string;

      if (data.imagePath.startsWith('http://') || data.imagePath.startsWith('https://')) {
        // URLの場合: ダウンロードして base64 に変換
        try {
          const resp = await axios.get(data.imagePath, { responseType: 'arraybuffer', timeout: 30000 });
          const base64 = Buffer.from(resp.data).toString('base64');
          imageDataUrl = `data:image/png;base64,${base64}`;
          console.log(`\x1b[35m🎨 画像ダウンロード完了 (${Math.round(resp.data.byteLength / 1024)}KB)\x1b[0m`);
        } catch (dlErr) {
          return `エラー: 画像URLからのダウンロードに失敗しました: ${dlErr instanceof Error ? dlErr.message : String(dlErr)}`;
        }
      } else {
        // ローカルファイルの場合: 読み込んで base64 に変換
        if (!fs.existsSync(data.imagePath)) {
          return `エラー: 画像ファイルが見つかりません: ${data.imagePath}`;
        }
        const imageBuffer = fs.readFileSync(data.imagePath);
        const base64 = imageBuffer.toString('base64');
        imageDataUrl = `data:image/png;base64,${base64}`;
      }

      console.log(
        `\x1b[35m🎨 画像編集開始: ${data.imagePath}\n   指示: ${data.prompt}\n   モデル: ${models.imageGeneration}\x1b[0m`,
      );

      // GPT Image モデル用: JSON 形式で REST API を直接呼び出す
      // SDK の images.edit() は multipart/form-data 固定で GPT Image モデルに非対応
      const response = await axios.post(
        'https://api.openai.com/v1/images/edits',
        {
          model: models.imageGeneration,
          images: [{ image_url: imageDataUrl }],
          prompt: data.prompt,
          n: 1,
          size: '1024x1024',
          quality: 'auto',
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          timeout: 120000,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        },
      );

      // gpt-image-1/1.5 は base64 で返す
      const b64Json = response.data?.data?.[0]?.b64_json;
      if (b64Json) {
        const filename = `edited_${Date.now()}.png`;
        const filepath = join(this.outputDir, filename);
        const imageBuffer = Buffer.from(b64Json, 'base64');
        fs.writeFileSync(filepath, imageBuffer);
        console.log(`\x1b[35m🎨 画像編集完了: ${filepath}\x1b[0m`);
        return `Image edited and saved to: ${filepath}`;
      }

      // フォールバック: URL
      const url = response.data?.data?.[0]?.url;
      if (url) {
        return `Image edited, url: ${url}`;
      }

      return 'Image was edited but no data was returned.';
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        console.error('Image edit API error:', error.response.status, JSON.stringify(error.response.data));
        return `画像編集APIエラー (${error.response.status}): ${JSON.stringify(error.response.data?.error?.message || error.response.data)}`;
      }
      console.error('Image edit error:', error);
      return `画像編集中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

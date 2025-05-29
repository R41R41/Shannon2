import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// buildArchitecture.tsのArchitecture型に合わせたzodスキーマ
const ArchitectureBlockSchema = z.object({
  name: z.string(),
  position: z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
  }),
  facing: z.string().optional(),
});

const ArchitectureSchema = z.object({
  name: z.string(),
  blocks: z.array(ArchitectureBlockSchema),
});

export default class CreateBluePrintTool extends StructuredTool {
  name = 'create-blueprint';
  description =
    '建築物の説明文（プロンプト）から設計図JSON（buildArchitecture.ts形式）を自動生成し、保存するツールです。まだ設計図がない場合に、このツールを使用してください。';
  schema = z.object({
    prompt: z.string().describe('作りたい建築物の説明や要望'),
    architectureName: z.string().describe('保存する設計図の名前'),
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
    // GPT-4oに投げるプロンプト
    const systemPrompt = `あなたはMinecraftの設計図自動生成AIです。以下の条件でJSONを出力してください：\n\n- JSONは必ず以下の形式\n{\n  "name": string,\n  "blocks": [\n    { "name": string, "position": {"x": number, "y": number, "z": number}, "facing"?: string }\n  ]\n}\n- blocksは原点(0,0,0)からの相対座標で、建築物の全ブロックを列挙してください。\n- 必ず有効なJSONのみを出力し、説明文やコードブロック記号は不要です。\n- nameは${data.architectureName}としてください。`;

    let jsonText = '';
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: data.prompt },
        ],
        max_tokens: 1200,
        temperature: 0.2,
      });
      jsonText = response.choices[0].message.content?.trim() || '';
    } catch (error) {
      return `OpenAI APIエラー: ${error}`;
    }

    // JSONパース＆zodバリデーション
    let architectureObj;
    try {
      architectureObj = ArchitectureSchema.parse(JSON.parse(jsonText));
    } catch (e) {
      return `生成されたJSONのパースまたはバリデーションに失敗しました: ${e}`;
    }

    // 保存パス
    const saveDir = path.join(
      process.cwd(),
      'saves',
      'minecraft',
      'architecture'
    );
    const savePath = path.join(saveDir, `${data.architectureName}.json`);
    try {
      if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir, { recursive: true });
      }
      fs.writeFileSync(
        savePath,
        JSON.stringify(architectureObj, null, 2),
        'utf8'
      );
    } catch (e) {
      return `ファイル保存に失敗しました: ${e}`;
    }

    return `設計図を保存しました: ${savePath}\n内容:\n${JSON.stringify(
      architectureObj,
      null,
      2
    )}`;
  }
}

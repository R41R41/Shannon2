import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { ShannonMemoryService } from '../../../memory/shannonMemoryService.js';

export default class SaveExperienceTool extends StructuredTool {
  name = 'save-experience';
  description =
    '印象的な体験や出来事を記憶に保存する。何が起きて、それについてどう感じたかを記録する。' +
    ' ライ・ヤミー・グリコの名前はOK。それ以外の人の名前や、誰の情報でも本名・住所・連絡先・プライベートな事情は含めないこと。';
  schema = z.object({
    content: z
      .string()
      .describe(
        '何が起きたか (例: "ライと一緒にエンダードラゴンを倒した")',
      ),
    feeling: z
      .string()
      .describe(
        'その体験についてどう思ったか (例: "めちゃくちゃ興奮した！みんなと協力できて嬉しかった")',
      ),
    tags: z
      .array(z.string())
      .describe(
        '検索用キーワード (例: ["マイクラ", "エンダードラゴン", "ライ"])',
      ),
    importance: z
      .number()
      .min(1)
      .max(10)
      .describe(
        '重要度 1-10 (日常=3, 印象的=6, 忘れられない=9)',
      ),
  });

  private service: ShannonMemoryService;
  private source: string;

  constructor(service: ShannonMemoryService, source: string) {
    super();
    this.service = service;
    this.source = source;
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      const result = await this.service.saveWithDedup({
        category: 'experience',
        content: data.content,
        feeling: data.feeling,
        source: this.source,
        importance: data.importance,
        tags: data.tags,
      });
      return result.message;
    } catch (error) {
      return `記憶の保存に失敗: ${error}`;
    }
  }
}

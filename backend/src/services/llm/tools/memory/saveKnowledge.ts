import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { ShannonMemoryService } from '../../../memory/shannonMemoryService.js';

export default class SaveKnowledgeTool extends StructuredTool {
  name = 'save-knowledge';
  description =
    '新しく学んだ知識や事実を記憶に保存する。' +
    ' ライ・ヤミー・グリコ以外の人の名前や、本名・住所・連絡先等の個人情報は含めないこと。';
  schema = z.object({
    content: z
      .string()
      .describe(
        '学んだこと (例: "レッドストーンリピーターは4段階の遅延を設定できる")',
      ),
    tags: z
      .array(z.string())
      .describe(
        '検索用キーワード (例: ["レッドストーン", "リピーター", "マイクラ"])',
      ),
    importance: z
      .number()
      .min(1)
      .max(10)
      .describe(
        '重要度 1-10 (豆知識=2, 実用的=5, 重要な発見=8)',
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
        category: 'knowledge',
        content: data.content,
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

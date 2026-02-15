import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { PersonMemoryService } from '../../../memory/personMemoryService.js';
import { MemoryPlatform } from '../../../../models/PersonMemory.js';

export default class RecallPersonTool extends StructuredTool {
  name = 'recall-person';
  description =
    '今話している人や特定の人物の情報を思い出す。特徴、過去の会話の要約、直近のやりとりが分かる。';
  schema = z.object({
    name: z
      .string()
      .describe('思い出したい人の名前 (例: "ライ", "ヤミー")'),
  });

  private service: PersonMemoryService;
  private currentPlatform: MemoryPlatform;

  constructor(service: PersonMemoryService, currentPlatform: MemoryPlatform) {
    super();
    this.service = service;
    this.currentPlatform = currentPlatform;
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      const person = await this.service.lookupByName(
        this.currentPlatform,
        data.name,
      );

      if (!person) {
        return `「${data.name}」という人は覚えてない…初めて会う人かも。`;
      }

      return this.service.formatForPrompt(person);
    } catch (error) {
      return `思い出せなかった: ${error}`;
    }
  }
}

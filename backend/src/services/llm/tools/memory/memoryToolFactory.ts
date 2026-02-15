import { StructuredTool } from '@langchain/core/tools';
import { MemoryPlatform } from '../../../../models/PersonMemory.js';
import { PersonMemoryService } from '../../../memory/personMemoryService.js';
import { ShannonMemoryService } from '../../../memory/shannonMemoryService.js';
import SaveExperienceTool from './saveExperience.js';
import SaveKnowledgeTool from './saveKnowledge.js';
import RecallExperienceTool from './recallExperience.js';
import RecallKnowledgeTool from './recallKnowledge.js';
import RecallPersonTool from './recallPerson.js';

/**
 * 記憶ツールを作成するファクトリ関数
 *
 * 各ツールに service インスタンスと platform を注入する。
 * platform はタスク実行時のコンテキストに応じて変わるため、
 * ツール作成はタスク実行ごとではなく初期化時に一度だけ行い、
 * platform は discord をデフォルトとする。
 * (recall-person は platform が変わっても lookupByName 内で解決される)
 */
export function createMemoryTools(
  platform: MemoryPlatform = 'discord',
  source: string = 'discord',
): StructuredTool[] {
  const personService = PersonMemoryService.getInstance();
  const shannonService = ShannonMemoryService.getInstance();

  return [
    new SaveExperienceTool(shannonService, source),
    new SaveKnowledgeTool(shannonService, source),
    new RecallExperienceTool(shannonService),
    new RecallKnowledgeTool(shannonService),
    new RecallPersonTool(personService, platform),
  ];
}

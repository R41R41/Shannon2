import { PromptType } from '@shannon/common';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const loadPrompt = async (
  promptType: PromptType,
  directoryName: string | null = null
): Promise<string> => {
  try {
    let path: string;
    if (directoryName) {
      path = join(
        __dirname,
        '../../../../saves/prompts',
        directoryName,
        `${promptType}.md`
      );
    } else {
      path = join(
        __dirname,
        '../../../../saves/prompts/others',
        `${promptType}.md`
      );
    }
    logger.debug(`Loading prompt: ${promptType}`);
    return readFileSync(path, 'utf-8').trim();
  } catch (error) {
    logger.error(`Failed to load prompt for ${promptType}:`, error);
    throw new Error(`プロンプトの読み込みに失敗しました: ${promptType}`);
  }
};

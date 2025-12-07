import { PromptType } from '@shannon/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CONFIG } from '../../config/MinebotConfig.js';

export const loadPrompt = async (
  promptType: PromptType,
  directoryName: string | null = null
): Promise<string> => {
  try {
    let path: string;
    if (directoryName) {
      path = join(
        CONFIG.PROMPTS_DIR,
        directoryName,
        `${promptType}.md`
      );
    } else {
      path = join(
        CONFIG.PROMPTS_DIR,
        'others',
        `${promptType}.md`
      );
    }
    console.log('Loading prompt from:', path);
    return readFileSync(path, 'utf-8').trim();
  } catch (error) {
    console.error(`Failed to load prompt for ${promptType}:`, error);
    throw new Error(`プロンプトの読み込みに失敗しました: ${promptType}`);
  }
};

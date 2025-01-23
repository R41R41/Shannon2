import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Platform, ConversationType } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const convertToPromptName = (type: Platform, conversationType: ConversationType): string => {
  if (type === 'discord') {
    return `discord_${conversationType}`;
  }
  if (type === 'web') {
    return `base_${conversationType}`;
  }
  if (type === 'minecraft') {
    return `base_text`;
  }
  return `${type}_${conversationType}`;
};

export const loadPrompt = async (type: Platform | `base_${ConversationType}`): Promise<string> => {
  try {
    const path = join(__dirname, 'prompts', `${type}.txt`);
    console.log('Loading prompt from:', path);
    return readFileSync(path, 'utf-8').trim();
  } catch (error) {
    console.error(`Failed to load prompt for ${type}:`, error);
    throw new Error(`プロンプトの読み込みに失敗しました: ${type}`);
  }
};
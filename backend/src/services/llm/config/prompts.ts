import { readFileSync } from 'fs';
import { join } from 'path';
import { Platform } from '../types/index.js';

export const loadPrompt = async (type: Platform | 'base'): Promise<string> => {
  try {
    const path = join(__dirname, '..', 'prompts', `${type}.txt`);
    return readFileSync(path, 'utf-8').trim();
  } catch (error) {
    console.error(`Failed to load prompt for ${type}:`, error);
    throw new Error(`プロンプトの読み込みに失敗しました: ${type}`);
  }
};

export const BASE_SYSTEM_PROMPT = await loadPrompt('base');

export const PLATFORM_PROMPTS: Record<Platform, string> = {
  twitter: await loadPrompt('twitter'),
  discord: await loadPrompt('discord'),
  youtube: await loadPrompt('youtube'),
  minecraft: await loadPrompt('minecraft')
}; 
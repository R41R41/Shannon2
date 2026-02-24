import { PromptType } from '@shannon/common';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROMPTS_WITH_PROFILE: Set<string> = new Set([
  'auto_tweet',
  'auto_tweet_review',
  'reply_twitter_comment',
  'respond_member_tweet',
]);

let cachedProfile: string | null = null;

function loadProfile(): string {
  if (cachedProfile !== null) return cachedProfile;
  const profilePath = join(
    __dirname,
    '../../../../saves/prompts/others/shannon_profile.md'
  );
  cachedProfile = readFileSync(profilePath, 'utf-8').trim();
  logger.debug('Loaded shannon_profile.md (cached)');
  return cachedProfile;
}

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
    let prompt = readFileSync(path, 'utf-8').trim();

    if (PROMPTS_WITH_PROFILE.has(promptType)) {
      const profile = loadProfile();
      prompt = profile + '\n\n---\n\n' + prompt;
      logger.debug(`Prepended shannon_profile to: ${promptType}`);
    }

    return prompt;
  } catch (error) {
    logger.error(`Failed to load prompt for ${promptType}:`, error);
    throw new Error(`プロンプトの読み込みに失敗しました: ${promptType}`);
  }
};

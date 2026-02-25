import { PromptType } from '@shannon/common';
import { readFileSync, watch, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROMPTS_DIR = join(__dirname, '../../../../saves/prompts');

const PROMPTS_WITH_PROFILE: Set<string> = new Set([
  'auto_tweet',
  'auto_tweet_review',
  'reply_twitter_comment',
  'respond_member_tweet',
]);

// --- キャッシュ ---
const promptCache = new Map<string, string>();
let cachedProfile: string | null = null;
let watcherActive = false;

function loadProfile(): string {
  if (cachedProfile !== null) return cachedProfile;
  const profilePath = join(PROMPTS_DIR, 'others/shannon_profile.md');
  cachedProfile = readFileSync(profilePath, 'utf-8').trim();
  logger.debug('Loaded shannon_profile.md (cached)');
  return cachedProfile;
}

function invalidateCache(filename: string) {
  if (filename === 'shannon_profile.md') {
    cachedProfile = null;
    promptCache.clear();
    logger.info('[Prompt] shannon_profile.md が変更されたため全キャッシュをクリア', 'cyan');
  } else if (filename.endsWith('.md')) {
    const key = filename.replace('.md', '');
    if (promptCache.delete(key)) {
      logger.info(`[Prompt] ${filename} のキャッシュをクリア`, 'cyan');
    }
  }
}

/**
 * プロンプトディレクトリを監視し、ファイル変更時にキャッシュを無効化する。
 * サーバー再起動なしでプロンプトの変更を反映可能。
 */
export function enablePromptHotReload(): void {
  if (watcherActive) return;
  if (!existsSync(PROMPTS_DIR)) return;

  try {
    watch(PROMPTS_DIR, { recursive: true }, (eventType, filename) => {
      if (filename && eventType === 'change') {
        invalidateCache(filename.replace(/^.*[\\/]/, ''));
      }
    });
    watcherActive = true;
    logger.info('[Prompt] ホットリロード有効: saves/prompts/ を監視中', 'green');
  } catch (err) {
    logger.warn(`[Prompt] ホットリロード開始失敗: ${err}`);
  }
}

export const loadPrompt = async (
  promptType: PromptType,
  directoryName: string | null = null
): Promise<string> => {
  const cacheKey = directoryName ? `${directoryName}/${promptType}` : promptType;
  const cached = promptCache.get(cacheKey);
  if (cached) return cached;

  try {
    let path: string;
    if (directoryName) {
      path = join(PROMPTS_DIR, directoryName, `${promptType}.md`);
    } else {
      path = join(PROMPTS_DIR, 'others', `${promptType}.md`);
    }
    logger.debug(`Loading prompt: ${promptType}`);
    let prompt = readFileSync(path, 'utf-8').trim();

    if (PROMPTS_WITH_PROFILE.has(promptType)) {
      const profile = loadProfile();
      prompt = profile + '\n\n---\n\n' + prompt;
      logger.debug(`Prepended shannon_profile to: ${promptType}`);
    }

    promptCache.set(cacheKey, prompt);
    return prompt;
  } catch (error) {
    logger.error(`Failed to load prompt for ${promptType}:`, error);
    throw new Error(`プロンプトの読み込みに失敗しました: ${promptType}`);
  }
};

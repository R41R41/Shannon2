/**
 * Discord スラッシュコマンド用の Minecraft サーバー選択肢。
 * config や外部ファイルから動的に生成可能。
 */
import fs from 'fs';
import path from 'path';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('Discord:ServerChoices');

interface ServerChoice {
  name: string;
  value: string;
}

const DEFAULT_CHOICES: ServerChoice[] = [
  { name: 'YouTube配信用', value: '1.21.4-fabric-youtube' },
  { name: 'テスト用', value: '1.21.4-test' },
  { name: 'プレイ用', value: '1.21.1-play' },
];

const CHOICES_FILE = path.resolve('saves/minecraft_servers.json');

/**
 * サーバー選択肢を読み込む。
 * saves/minecraft_servers.json が存在すればそちらを優先、なければデフォルト。
 */
export function loadServerChoices(): ServerChoice[] {
  try {
    if (fs.existsSync(CHOICES_FILE)) {
      const data = JSON.parse(fs.readFileSync(CHOICES_FILE, 'utf-8'));
      if (Array.isArray(data) && data.length > 0) {
        log.info(`サーバー選択肢を ${CHOICES_FILE} から読み込み (${data.length}件)`);
        return data;
      }
    }
  } catch (err) {
    log.warn(`サーバー選択肢ファイル読み込み失敗: ${err}`);
  }
  return DEFAULT_CHOICES;
}

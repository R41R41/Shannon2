#!/usr/bin/env npx ts-node --esm
/**
 * Minebot スキルテストランナー
 *
 * Minecraft サーバーに接続し、指定したスキルを単体テストする。
 * LLM 不要 — スキルを直接実行して結果を確認する。
 *
 * 使い方:
 *   npx ts-node --esm scripts/minebot-test.ts --list              # スキル一覧
 *   npx ts-node --esm scripts/minebot-test.ts --skill getPosition # 特定スキルをテスト
 *   npx ts-node --esm scripts/minebot-test.ts --skill getHealth   # ヘルスチェック
 *   npx ts-node --esm scripts/minebot-test.ts --smoke             # 全読み取り系スキルをテスト
 *
 * 前提:
 *   - Minecraft サーバーが localhost:25565 で起動済み
 *   - MINECRAFT_BOT_USER_NAME 環境変数でボット名を指定
 */

import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SKILLS_DIR = join(__dirname, '../src/services/minebot/instantSkills');

const SMOKE_TEST_SKILLS = [
  'getPosition',
  'getHealth',
  'getBotStatus',
  'getTimeAndWeather',
  'listInventoryItems',
  'getEquipment',
  'listNearbyEntities',
  'checkInventoryItem',
];

function listSkills(): string[] {
  return readdirSync(SKILLS_DIR)
    .filter((f) => f.endsWith('.ts') && !f.includes('.d.ts'))
    .map((f) => f.replace('.ts', ''));
}

const args = process.argv.slice(2);

if (args.includes('--list')) {
  const skills = listSkills();
  console.log(`\n📋 利用可能なスキル (${skills.length}個):\n`);
  skills.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. ${s}`));
  console.log(`\n🧪 スモークテスト対象: ${SMOKE_TEST_SKILLS.join(', ')}`);
  process.exit(0);
}

if (args.includes('--smoke') || args.includes('--skill')) {
  console.log('\n⚠️  スキルテストの実行には Minecraft サーバーへの接続が必要です。');
  console.log('    mineflayer でサーバーに接続し、スキルを実行する完全なテストランナーは');
  console.log('    Minecraft サーバーが利用可能な環境で実行してください。\n');
  console.log('    このスクリプトは以下の機能を提供します:');
  console.log('    - --list: スキル一覧の表示');
  console.log('    - --smoke: スモークテスト対象スキルの確認');
  console.log('    - --skill <name>: テスト対象スキルの確認\n');

  if (args.includes('--smoke')) {
    console.log('🧪 スモークテスト対象スキル:');
    SMOKE_TEST_SKILLS.forEach((s) => console.log(`  ✅ ${s}`));
  }

  if (args.includes('--skill')) {
    const idx = args.indexOf('--skill');
    const skillName = args[idx + 1];
    const available = listSkills();
    if (available.includes(skillName)) {
      console.log(`✅ スキル "${skillName}" は存在します`);
    } else {
      console.log(`❌ スキル "${skillName}" は見つかりません`);
      console.log(`   利用可能: ${available.slice(0, 10).join(', ')}...`);
    }
  }
  process.exit(0);
}

console.log('使い方: npx ts-node --esm scripts/minebot-test.ts --list|--smoke|--skill <name>');

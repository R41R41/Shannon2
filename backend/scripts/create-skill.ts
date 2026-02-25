#!/usr/bin/env npx ts-node --esm
/**
 * Minebot スキル作成ウィザード
 *
 * テンプレートから新しいスキルファイルを生成する。
 *
 * 使い方:
 *   npx ts-node --esm scripts/create-skill.ts <skillName> [description]
 *
 * 例:
 *   npx ts-node --esm scripts/create-skill.ts buildWall "指定した方向に壁を建てる"
 *
 * → backend/src/services/minebot/instantSkills/buildWall.ts が生成される
 */

import { writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, '../src/services/minebot/instantSkills');

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('使い方: npx ts-node --esm scripts/create-skill.ts <skillName> [description]');
  console.log('例:     npx ts-node --esm scripts/create-skill.ts buildWall "壁を建てる"');
  process.exit(1);
}

const camelName = args[0];
const className = camelName.charAt(0).toUpperCase() + camelName.slice(1);
const kebabName = camelName.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
const description = args[1] || 'TODO: スキルの説明を書いてください';
const filePath = join(SKILLS_DIR, `${camelName}.ts`);

if (existsSync(filePath)) {
  console.error(`❌ ${filePath} は既に存在します`);
  process.exit(1);
}

const template = `import { CustomBot, InstantSkill, SkillParam } from '../types.js';

/**
 * 原子的スキル: ${description}
 */
class ${className} extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = '${kebabName}';
    this.description = '${description}';
    this.params = [
      // { name: 'target', type: 'string', description: '対象の名前' },
    ];
  }

  async runImpl(args: string[]) {
    try {
      // TODO: スキルの実装

      return {
        success: true,
        result: '${description} — 完了',
      };
    } catch (error: any) {
      return {
        success: false,
        result: \`エラー: \${error.message}\`,
      };
    }
  }
}

export default ${className};
`;

writeFileSync(filePath, template);
console.log(`✅ スキル作成: ${filePath}`);
console.log(`   クラス名: ${className}`);
console.log(`   スキル名: ${kebabName}`);
console.log(`   説明: ${description}`);

import { StructuredTool } from '@langchain/core/tools';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

export default class UpdateSkillCodeTool extends StructuredTool {
    name = 'update-skill-code';
    description =
        '既存のスキルファイルのソースコードを更新します。エラーを修正したり、機能を改善したりできます。';
    schema = z.object({
        skillName: z
            .string()
            .describe('スキル名（例: "move-to", "chat", "dig-block-at"）'),
        skillType: z
            .enum(['instant', 'constant'])
            .default('instant')
            .describe('スキルタイプ: instant（即時実行）またはconstant（常時実行）'),
        newCode: z.string().describe('新しいソースコード（完全なTypeScriptコード）'),
    });

    async _call(input: {
        skillName: string;
        skillType: 'instant' | 'constant';
        newCode: string;
    }): Promise<string> {
        try {
            const { skillName, skillType, newCode } = input;

            // スキルファイルのパスを構築
            const baseDir = process.cwd();
            const skillDir =
                skillType === 'instant' ? 'instantSkills' : 'constantSkills';
            const skillPath = path.join(
                baseDir,
                'src',
                'services',
                'minebot',
                skillDir,
                `${skillName}.ts`
            );

            // ファイルが存在するか確認
            if (!fs.existsSync(skillPath)) {
                return `エラー: スキル "${skillName}" が見つかりません（パス: ${skillPath}）`;
            }

            // バックアップを作成
            const backupPath = `${skillPath}.backup`;
            fs.copyFileSync(skillPath, backupPath);

            // 新しいコードを書き込む
            fs.writeFileSync(skillPath, newCode, 'utf-8');

            const lineCount = newCode.split('\n').length;

            return `成功: スキル "${skillName}" を更新しました（${lineCount}行）。バックアップ: ${backupPath}\n\n**重要**: 変更を反映するには、バックエンドを再ビルド（npm run build）して再起動する必要があります。`;
        } catch (error) {
            return `スキルコードの更新エラー: ${error}`;
        }
    }
}


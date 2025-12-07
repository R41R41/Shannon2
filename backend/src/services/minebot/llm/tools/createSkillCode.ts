import { StructuredTool } from '@langchain/core/tools';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

export default class CreateSkillCodeTool extends StructuredTool {
    name = 'create-skill-code';
    description =
        '新しいスキルファイルを作成します。完全に新しい機能を追加できます。';
    schema = z.object({
        skillName: z
            .string()
            .describe(
                'スキル名（ケバブケース、例: "my-new-skill", "advanced-pathfinding"）'
            ),
        skillType: z
            .enum(['instant', 'constant'])
            .default('instant')
            .describe('スキルタイプ: instant（即時実行）またはconstant（常時実行）'),
        code: z.string().describe('完全なTypeScriptソースコード'),
    });

    async _call(input: {
        skillName: string;
        skillType: 'instant' | 'constant';
        code: string;
    }): Promise<string> {
        try {
            const { skillName, skillType, code } = input;

            // スキル名の検証（ケバブケースのみ許可）
            if (!/^[a-z][a-z0-9-]*$/.test(skillName)) {
                return `エラー: スキル名は小文字とハイフンのみ使用できます（例: "my-skill"）`;
            }

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

            // ファイルが既に存在するか確認
            if (fs.existsSync(skillPath)) {
                return `エラー: スキル "${skillName}" は既に存在します。update-skill-code を使用してください。`;
            }

            // 新しいファイルを作成
            fs.writeFileSync(skillPath, code, 'utf-8');

            const lineCount = code.split('\n').length;

            return `成功: 新しいスキル "${skillName}" を作成しました（${lineCount}行）。\nパス: ${skillPath}\n\n**重要**: 変更を反映するには、バックエンドを再ビルド（npm run build）して再起動する必要があります。`;
        } catch (error) {
            return `スキルコードの作成エラー: ${error}`;
        }
    }
}


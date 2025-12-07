import { StructuredTool } from '@langchain/core/tools';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

export default class ReadSkillCodeTool extends StructuredTool {
    name = 'read-skill-code';
    description =
        'スキルファイルのソースコードを読み込みます。エラーが発生したスキルの実装を確認して問題を分析できます。';
    schema = z.object({
        skillName: z
            .string()
            .describe(
                'スキル名（例: "move-to", "chat", "dig-block-at"）。ファイル名から.tsを除いたもの'
            ),
        skillType: z
            .enum(['instant', 'constant'])
            .default('instant')
            .describe('スキルタイプ: instant（即時実行）またはconstant（常時実行）'),
    });

    async _call(input: {
        skillName: string;
        skillType: 'instant' | 'constant';
    }): Promise<string> {
        try {
            const { skillName, skillType } = input;

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

            // ファイルを読み込む
            const code = fs.readFileSync(skillPath, 'utf-8');
            const lineCount = code.split('\n').length;

            return `スキル "${skillName}" のコード（${lineCount}行）:\n\n${code}`;
        } catch (error) {
            return `スキルコードの読み込みエラー: ${error}`;
        }
    }
}


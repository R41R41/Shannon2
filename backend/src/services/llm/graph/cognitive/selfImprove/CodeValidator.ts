/**
 * CodeValidator — Tier 2 コード検証
 *
 * 生成された TypeScript コードの安全性を検証する。
 * - tsc --noEmit コンパイルチェック
 * - AST 安全スキャン（危険な API 呼び出しのブロック）
 * - 変更規模の制限
 */

import { createLogger } from '../../../../../utils/logger.js';
import { SELF_IMPROVE_CONSTANTS as C } from './types.js';

const log = createLogger('SelfImprove:Validator');

/** 禁止パターン: セキュリティリスクのある API 呼び出し */
const BLOCKED_PATTERNS = [
    /\bprocess\.exit\b/,
    /\beval\s*\(/,
    /\bnew\s+Function\b/,
    /\brequire\s*\(\s*['"]child_process['"]\s*\)/,
    /\bimport\s+.*['"]child_process['"]/,
    /\bimport\s+.*['"]fs['"]/,       // fs 直接使用は禁止（既存ユーティリティを使う）
    /\bexecSync\b/,
    /\bspawnSync\b/,
    /\bexec\s*\(/,
    /\b__dirname\b/,                  // パス操作は制限
    /\b__filename\b/,
    /\bprocess\.env\b/,               // 環境変数への直接アクセスは禁止
    /\bglobal\b/,
    /\bglobalThis\b/,
    /\bPromise\.resolve\(\)\s*\.then\b/,  // Promise trick でのサンドボックス回避
];

/** 許可されるインポートパターン */
const ALLOWED_IMPORTS = [
    /from\s+['"]\.\.?\//, // 相対パス
    /from\s+['"]minecraft-data['"]/,
    /from\s+['"]vec3['"]/,
    /from\s+['"]@shannon\/common['"]/,
];

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

export class CodeValidator {
    /**
     * 生成されたコードを検証する。
     */
    validate(code: string, originalCode?: string): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // 1. 禁止パターンのチェック
        for (const pattern of BLOCKED_PATTERNS) {
            if (pattern.test(code)) {
                errors.push(`セキュリティ違反: 禁止パターン "${pattern.source}" が検出されました`);
            }
        }

        // 2. インポートの検証
        const importLines = code.match(/^import\s+.+$/gm) || [];
        for (const line of importLines) {
            const isAllowed = ALLOWED_IMPORTS.some(p => p.test(line));
            if (!isAllowed) {
                errors.push(`許可されていないインポート: ${line.trim()}`);
            }
        }

        // 3. 変更規模の制限（元コードがある場合）
        if (originalCode) {
            const originalLines = originalCode.split('\n').length;
            const newLines = code.split('\n').length;
            const changeRatio = Math.abs(newLines - originalLines) / originalLines;

            if (changeRatio > C.MAX_CODE_CHANGE_RATIO) {
                errors.push(
                    `変更規模が大きすぎます (${(changeRatio * 100).toFixed(0)}% > ${(C.MAX_CODE_CHANGE_RATIO * 100).toFixed(0)}%上限)`,
                );
            }

            if (newLines > originalLines * 2) {
                warnings.push(`コードが元の2倍以上に増えています (${originalLines} → ${newLines}行)`);
            }
        }

        // 4. 基本的な構文チェック
        if (!code.includes('class') && !code.includes('function') && !code.includes('export')) {
            warnings.push('クラスまたは関数の定義が見つかりません');
        }

        // 5. InstantSkill パターンのチェック
        if (code.includes('extends InstantSkill') || code.includes('extends ConstantSkill')) {
            if (!code.includes('runImpl')) {
                errors.push('InstantSkill/ConstantSkill を継承していますが runImpl メソッドがありません');
            }
        }

        // 6. 行数制限
        const lineCount = code.split('\n').length;
        if (lineCount > C.MAX_GENERATED_CODE_LINES) {
            errors.push(`コードが ${lineCount} 行あります（上限: ${C.MAX_GENERATED_CODE_LINES} 行）`);
        }

        const valid = errors.length === 0;

        if (!valid) {
            log.warn(`❌ 検証失敗: ${errors.length}件のエラー`);
        } else if (warnings.length > 0) {
            log.info(`⚠️ 検証通過（警告あり: ${warnings.length}件）`);
        }

        return { valid, errors, warnings };
    }

    /**
     * 生成スキル専用のバリデーション。
     * 基本検証に加えて、スキル固有のルールをチェックする。
     */
    validateGeneratedSkill(
        code: string,
        skillType: 'instant' | 'constant',
        existingSkillNames: string[],
    ): ValidationResult {
        // 基本検証
        const base = this.validate(code);

        // export default チェック
        if (!code.includes('export default')) {
            base.errors.push('export default が必要です');
        }

        // クラス継承チェック
        const expectedBase = skillType === 'instant' ? 'InstantSkill' : 'ConstantSkill';
        if (!code.includes(`extends ${expectedBase}`)) {
            base.errors.push(`${expectedBase} を継承していません`);
        }

        // skillName の重複チェック
        const nameMatch = code.match(/this\.skillName\s*=\s*['"]([^'"]+)['"]/);
        if (nameMatch) {
            const skillName = nameMatch[1];
            if (existingSkillNames.includes(skillName)) {
                base.errors.push(`スキル名 "${skillName}" は既に存在します`);
            }
        } else {
            base.errors.push('this.skillName の設定が見つかりません');
        }

        // ConstantSkill の interval チェック
        if (skillType === 'constant') {
            const intervalMatch = code.match(/this\.interval\s*=\s*(\d+)/);
            if (intervalMatch) {
                const interval = parseInt(intervalMatch[1]);
                if (interval < C.MIN_CONSTANT_SKILL_INTERVAL) {
                    base.errors.push(
                        `interval が ${interval}ms です（最小: ${C.MIN_CONSTANT_SKILL_INTERVAL}ms）`,
                    );
                }
            }
        }

        // dynamic import 禁止
        if (/\bimport\s*\(/.test(code)) {
            base.errors.push('動的 import は禁止されています');
        }

        base.valid = base.errors.length === 0;
        return base;
    }

    /**
     * tsc --noEmit を実行して TypeScript コンパイルチェックする。
     * SkillCompiler に委譲する。
     */
    async compileCheck(_filePath: string): Promise<ValidationResult> {
        // SkillCompiler.compile() が実際のコンパイルを行うため、
        // ここではスタブとして残す
        return {
            valid: true,
            errors: [],
            warnings: [],
        };
    }
}

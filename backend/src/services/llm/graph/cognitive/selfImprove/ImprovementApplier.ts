/**
 * ImprovementApplier — 改善の適用
 *
 * Tier 1: self_improvement_rules.json にルールを追加（ホットリロード）
 * Tier 2: レビュー待ちとしてフラグ（将来的に git commit）
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createLogger } from '../../../../../utils/logger.js';
import { randomUUID } from 'node:crypto';
import { CodeValidator } from './CodeValidator.js';
import type {
    ImprovementProposal,
    ImprovementRecord,
    SelfImprovementRulesFile,
    DynamicRule,
} from './types.js';
import { SELF_IMPROVE_CONSTANTS as C } from './types.js';

const log = createLogger('SelfImprove:Applier');

/** プロジェクトルートからの相対パスを解決 */
function resolveProjectPath(relativePath: string): string {
    // backend/saves/... → プロジェクトルートからの相対パス
    return resolve(process.cwd(), relativePath);
}

export class ImprovementApplier {
    private validator = new CodeValidator();

    /**
     * 改善案を適用する。
     */
    async apply(proposal: ImprovementProposal): Promise<ImprovementRecord> {
        if (proposal.tier === 1) {
            return this.applyTier1(proposal);
        } else {
            return this.applyTier2(proposal);
        }
    }

    // ── Tier 1: JSON ルール追加 ──

    private async applyTier1(proposal: ImprovementProposal): Promise<ImprovementRecord> {
        try {
            const rulesFile = await this.loadRulesFile();

            // 重複チェック
            const isDuplicate = rulesFile.rules.some(
                r => r.enabled && r.rule === proposal.content,
            );
            if (isDuplicate) {
                return {
                    proposal,
                    status: 'rejected',
                    appliedAt: null,
                    validationErrors: ['同一ルールが既に存在します'],
                    effectiveness: null,
                    gitBranch: null,
                };
            }

            const target = proposal.scope === 'prompt_rule' ? 'prompt' : 'forward_model';

            const newRule: DynamicRule = {
                id: randomUUID(),
                target,
                rule: proposal.content,
                sourceFailure: proposal.sourceCluster.summary,
                addedAt: Date.now(),
                enabled: true,
            };

            rulesFile.rules.push(newRule);
            rulesFile.version++;
            rulesFile.lastUpdated = Date.now();

            await this.saveRulesFile(rulesFile);

            log.info(`✅ Tier 1 ルール追加: [${target}] ${proposal.content.substring(0, 60)}`);

            return {
                proposal,
                status: 'applied',
                appliedAt: Date.now(),
                validationErrors: [],
                effectiveness: null,
                gitBranch: null,
            };
        } catch (err) {
            log.error('Tier 1 適用エラー', err);
            return {
                proposal,
                status: 'rejected',
                appliedAt: null,
                validationErrors: [`適用エラー: ${(err as Error).message}`],
                effectiveness: null,
                gitBranch: null,
            };
        }
    }

    // ── Tier 2: レビュー待ち（将来的に git commit） ──

    private async applyTier2(proposal: ImprovementProposal): Promise<ImprovementRecord> {
        // Tier 2 はコード検証を行い、レビュー待ちとする
        const validation = this.validator.validate(proposal.content);

        if (!validation.valid) {
            return {
                proposal,
                status: 'rejected',
                appliedAt: null,
                validationErrors: validation.errors,
                effectiveness: null,
                gitBranch: null,
            };
        }

        // TODO: Phase 7 で git ブランチ作成 & コミット を実装
        log.info(`👀 Tier 2 改善案をレビュー待ちとして記録: ${proposal.description}`);

        // 履歴ファイルに記録
        await this.appendToHistory(proposal, 'pending_review');

        return {
            proposal,
            status: 'pending_review',
            appliedAt: null,
            validationErrors: [],
            effectiveness: null,
            gitBranch: null, // Phase 7 で設定
        };
    }

    // ── ルールファイル I/O ──

    async loadRulesFile(): Promise<SelfImprovementRulesFile> {
        try {
            const filePath = resolveProjectPath(C.RULES_FILE_PATH);
            const content = await readFile(filePath, 'utf-8');
            return JSON.parse(content) as SelfImprovementRulesFile;
        } catch {
            // ファイルが存在しない場合は初期状態を返す
            return {
                version: 0,
                rules: [],
                lastUpdated: Date.now(),
            };
        }
    }

    private async saveRulesFile(data: SelfImprovementRulesFile): Promise<void> {
        const filePath = resolveProjectPath(C.RULES_FILE_PATH);
        await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }

    private async appendToHistory(
        proposal: ImprovementProposal,
        status: string,
    ): Promise<void> {
        try {
            const filePath = resolveProjectPath(C.HISTORY_FILE_PATH);
            let history: unknown[] = [];
            try {
                const content = await readFile(filePath, 'utf-8');
                history = JSON.parse(content);
            } catch { /* file doesn't exist yet */ }

            history.push({
                proposalId: proposal.id,
                tier: proposal.tier,
                scope: proposal.scope,
                description: proposal.description,
                status,
                timestamp: Date.now(),
            });

            // 最大500件に制限
            if (history.length > 500) {
                history = history.slice(-500);
            }

            await writeFile(filePath, JSON.stringify(history, null, 2), 'utf-8');
        } catch (err) {
            log.error('履歴ファイル書き込みエラー', err);
        }
    }
}

/**
 * ImprovementGenerator — 改善案生成
 *
 * FailureAnalyzer の分析結果を受け取り、具体的な改善案（ImprovementProposal）を生成する。
 *
 * Tier 1: gpt-4.1-mini でプロンプトルール / ForwardModel ルールの JSON パッチを生成
 * Tier 2: Claude / gpt-4.1 でスキルコードの TypeScript 修正を生成
 */

import { z } from 'zod';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { createTracedModel } from '../../../utils/langfuse.js';
import { createLogger } from '../../../../../utils/logger.js';
import { randomUUID } from 'node:crypto';
import type {
    FailureAnalysisResult,
    FailureCluster,
    ImprovementProposal,
    ImprovementScope,
} from './types.js';

const log = createLogger('SelfImprove:Generator');

// ── Zod Schemas ──

const Tier1ProposalSchema = z.object({
    target: z.enum(['prompt', 'forward_model']).describe('追加先 (prompt=PromptBuilder, forward_model=ForwardModel)'),
    rule: z.string().describe('追加するルール文（日本語、1-3文）。プロンプトの場合はMarkdownの箇条書き形式、ForwardModelの場合は条件→結果の形式で記述'),
    reasoning: z.string().describe('このルールが必要な理由（1文）'),
});

const Tier1OutputSchema = z.object({
    proposals: z.array(Tier1ProposalSchema).describe('Tier 1 改善案リスト'),
});

const Tier2ProposalSchema = z.object({
    description: z.string().describe('コード修正の説明（日本語、1-2文）'),
    targetFile: z.string().describe('修正対象ファイルの相対パス'),
    codeChange: z.string().describe('修正内容（TypeScript コード差分の説明）'),
    reasoning: z.string().describe('この修正が必要な理由（1文）'),
});

const Tier2OutputSchema = z.object({
    proposals: z.array(Tier2ProposalSchema).describe('Tier 2 改善案リスト'),
});

// ── System Prompts ──

const TIER1_SYSTEM_PROMPT = `あなたは Minecraft ボット「シャノン」の行動ルールを改善するエキスパートです。

失敗分析の結果に基づいて、以下のいずれかの形式でルールを生成してください:

## prompt ルール（PromptBuilder に追加）
- LLM が行動を決定する際のガイドラインとして追加される
- 「〜する前に〜を確認する」「〜の場合は〜を優先する」等の行動指針
- Markdown 箇条書き形式（「- **太字部分**: 説明」）

## forward_model ルール（ForwardModel に追加）
- ツール実行前の失敗予測に使われる
- 「[ツール名] を [条件] で呼んだ場合 → [予測結果]」の形式
- より具体的・技術的な条件を記述

## 注意事項
- 既存ルールと重複しないようにする
- 過度に一般的なルールは避け、具体的な失敗パターンに対応したルールにする
- 1つの失敗クラスタに対して最大2つまでのルールを生成`;

const TIER2_SYSTEM_PROMPT = `あなたは Minecraft ボット「シャノン」の InstantSkill (TypeScript) を改善するエキスパートです。

失敗分析の結果に基づいて、スキルコードの具体的な修正案を提案してください。

## 修正方針
- 最小限の変更で失敗パターンを解決する
- 既存のコード構造を壊さない
- 安全なフォールバックを含める
- 新しい依存関係は追加しない

## 対象スキル
修正対象は backend/src/services/minebot/instantSkills/ 配下の TypeScript ファイル。
各スキルは InstantSkill を継承し、runImpl() メソッドにメインロジックがある。`;

export class ImprovementGenerator {
    /**
     * 分析結果から改善案を生成する。
     */
    async generate(analysis: FailureAnalysisResult): Promise<ImprovementProposal[]> {
        const proposals: ImprovementProposal[] = [];

        // Tier 1 クラスタと Tier 2 クラスタを分離
        const tier1Clusters = analysis.clusters.filter(c => c.suggestedTier === 1);
        const tier2Clusters = analysis.clusters.filter(c => c.suggestedTier === 2);

        // Tier 1: プロンプト/ForwardModel ルール生成
        if (tier1Clusters.length > 0) {
            try {
                const tier1Proposals = await this.generateTier1(tier1Clusters);
                proposals.push(...tier1Proposals);
            } catch (err) {
                log.error('Tier 1 改善案生成エラー', err);
            }
        }

        // Tier 2: コード修正案生成
        if (tier2Clusters.length > 0) {
            try {
                const tier2Proposals = await this.generateTier2(tier2Clusters);
                proposals.push(...tier2Proposals);
            } catch (err) {
                log.error('Tier 2 改善案生成エラー', err);
            }
        }

        return proposals;
    }

    // ── Tier 1: JSON ルール生成 ──

    private async generateTier1(clusters: FailureCluster[]): Promise<ImprovementProposal[]> {
        const model = createTracedModel({
            modelName: 'gpt-4.1-mini',
            temperature: 0.3,
        });

        const structuredLLM = model.withStructuredOutput(Tier1OutputSchema, {
            name: 'Tier1Improvement',
        });

        const prompt = this.buildTier1Prompt(clusters);

        const response = await structuredLLM.invoke([
            new SystemMessage(TIER1_SYSTEM_PROMPT),
            new HumanMessage(prompt),
        ]);

        return response.proposals.map((p, i) => {
            const cluster = clusters[Math.min(i, clusters.length - 1)];
            const scope: ImprovementScope = p.target === 'prompt' ? 'prompt_rule' : 'forward_model';

            return {
                id: randomUUID(),
                tier: 1 as const,
                scope,
                description: `[${p.target}] ${p.rule.substring(0, 80)}`,
                targetFile: null,
                content: p.rule,
                sourceCluster: cluster,
                createdAt: Date.now(),
            };
        });
    }

    private buildTier1Prompt(clusters: FailureCluster[]): string {
        const lines: string[] = ['## 失敗クラスタ分析結果\n'];

        for (let i = 0; i < clusters.length; i++) {
            const c = clusters[i];
            lines.push(`### クラスタ ${i + 1}: ${c.rootCause}`);
            lines.push(`- 要約: ${c.summary}`);
            lines.push(`- 発生回数: ${c.occurrenceCount}`);
            if (c.affectedSkill) lines.push(`- 関連スキル: ${c.affectedSkill}`);
            lines.push('');
        }

        lines.push('上記の失敗パターンを防ぐためのルールを生成してください。');

        return lines.join('\n');
    }

    // ── Tier 2: コード修正案生成 ──

    private async generateTier2(clusters: FailureCluster[]): Promise<ImprovementProposal[]> {
        const model = createTracedModel({
            modelName: 'gpt-4.1-mini',
            temperature: 0.2,
        });

        const structuredLLM = model.withStructuredOutput(Tier2OutputSchema, {
            name: 'Tier2Improvement',
        });

        const prompt = this.buildTier2Prompt(clusters);

        const response = await structuredLLM.invoke([
            new SystemMessage(TIER2_SYSTEM_PROMPT),
            new HumanMessage(prompt),
        ]);

        return response.proposals.map((p, i) => {
            const cluster = clusters[Math.min(i, clusters.length - 1)];

            return {
                id: randomUUID(),
                tier: 2 as const,
                scope: 'skill_code' as const,
                description: p.description,
                targetFile: p.targetFile,
                content: p.codeChange,
                sourceCluster: cluster,
                createdAt: Date.now(),
            };
        });
    }

    private buildTier2Prompt(clusters: FailureCluster[]): string {
        const lines: string[] = ['## コード修正が必要な失敗クラスタ\n'];

        for (let i = 0; i < clusters.length; i++) {
            const c = clusters[i];
            lines.push(`### クラスタ ${i + 1}: ${c.rootCause}`);
            lines.push(`- 要約: ${c.summary}`);
            lines.push(`- 発生回数: ${c.occurrenceCount}`);
            if (c.affectedSkill) {
                lines.push(`- 関連スキル: ${c.affectedSkill}`);
                lines.push(`- ファイル: backend/src/services/minebot/instantSkills/${c.affectedSkill.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}.ts`);
            }
            lines.push('');
        }

        lines.push('上記の失敗パターンを解決するコード修正を提案してください。');

        return lines.join('\n');
    }
}

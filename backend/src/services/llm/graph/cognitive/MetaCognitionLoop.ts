import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { config } from '../../../../config/env.js';
import { logger } from '../../../../utils/logger.js';
import { createTracedModel } from '../../utils/langfuse.js';
import { CognitiveBlackboard, MetaAssessment, MetaState } from './CognitiveBlackboard.js';
import { ModelSelector } from './ModelSelector.js';

/**
 * MetaCognitionLoop — 前頭前皮質 (DLPFC) に相当するメタ認知プロセス。
 *
 * タスク実行の進捗を俯瞰的に評価し、以下の介入を行う:
 *   - フィードバック注入 (FCA の pendingFeedback へ)
 *   - モデルエスカレーション / デエスカレーション
 *   - タスク停止
 *
 * トリガー:
 *   - task:updated (3イテレーション分蓄積後)
 *   - loop:detected (即座に)
 *   - emotion:shifted (即座に)
 */

const MetaOutputSchema = z.object({
    assessment: z.enum(['on_track', 'struggling', 'stuck', 'wrong_approach'])
        .describe('タスクの進捗評価'),
    suggestion: z.string().nullable()
        .describe('タスク実行プロセスへの具体的なアドバイス（null=介入不要）'),
    modelAction: z.enum(['escalate', 'deescalate', 'hold'])
        .describe('モデルの切り替え判断'),
    shouldStop: z.boolean()
        .describe('タスクを停止すべきか'),
    reasoning: z.string()
        .describe('判断の理由（1-2文）'),
});

const META_SYSTEM_PROMPT = `あなたはAIエージェント「シャノン」の前頭前皮質（メタ認知プロセス）です。
タスク実行プロセスの進捗を俯瞰的に監視し、適切な介入判断を下してください。

# 判断基準

## assessment（進捗評価）
- on_track: 順調に進んでいる。成功率が高く、目標に近づいている
- struggling: 一部で問題が発生しているが、進展はある
- stuck: 同じ失敗を繰り返している、または進展がない
- wrong_approach: 根本的にアプローチが間違っている

## modelAction（モデル切り替え）
- escalate: より強力なモデルが必要（複雑な推論が求められる場合）
- deescalate: 現在のモデルは過剰（単純なタスクにコストをかけすぎている場合）
- hold: 現状維持

## shouldStop
- true: これ以上の実行は無駄（例: 必要なリソースが存在しない、前提条件が満たせない）
- false: 継続すべき

## suggestion
- 具体的で実行可能なアドバイスを1-2文で。
- タスク実行プロセスが次に何をすべきかを明確に指示する。
- 例: 「crafting_tableがないため、まず木材を集めてcrafting_tableを作成すべき」`;

const EVALUATE_INTERVAL_ITERATIONS = 3;

/**
 * 連続成功/失敗を追跡し、ドーパミンシステム的な予測誤差シグナルを生成する。
 */
interface RewardTracker {
    consecutiveSuccesses: number;
    consecutiveFailures: number;
    recentRewardSignals: Array<{ type: 'positive' | 'negative'; magnitude: number; iteration: number }>;
}

export class MetaCognitionLoop {
    private blackboard: CognitiveBlackboard;
    private modelSelector: ModelSelector;
    private model: ChatOpenAI;
    private stopped = false;
    private lastEvaluatedIteration = -1;
    private feedbackCallback: ((feedback: string) => void) | null = null;
    private interruptCallback: (() => void) | null = null;
    private reward: RewardTracker = {
        consecutiveSuccesses: 0,
        consecutiveFailures: 0,
        recentRewardSignals: [],
    };

    constructor(
        blackboard: CognitiveBlackboard,
        modelSelector: ModelSelector,
    ) {
        this.blackboard = blackboard;
        this.modelSelector = modelSelector;
        this.model = createTracedModel({
            modelName: 'gpt-4.1-mini',
            apiKey: config.openaiApiKey,
        });
    }

    /**
     * FCA の pendingFeedback に注入するためのコールバックを設定
     */
    setFeedbackCallback(cb: (feedback: string) => void): void {
        this.feedbackCallback = cb;
    }

    /**
     * 現在実行中のスキルを中断するためのコールバックを設定。
     * assessment が wrong_approach / stuck の場合に呼ばれる。
     */
    setInterruptCallback(cb: () => void): void {
        this.interruptCallback = cb;
    }

    async run(): Promise<void> {
        this.stopped = false;

        const onTaskUpdated = () => {
            const { iteration } = this.blackboard.taskState;
            if (iteration - this.lastEvaluatedIteration >= EVALUATE_INTERVAL_ITERATIONS) {
                void this.evaluate('periodic');
            }
        };
        const onLoopDetected = (summary: string) => void this.evaluate(`loop_detected: ${summary}`);
        const onEmotionShifted = () => void this.evaluate('emotion_shifted');
        const onCompleted = () => { this.stopped = true; };

        this.blackboard.on('task:updated', onTaskUpdated);
        this.blackboard.on('loop:detected', onLoopDetected);
        this.blackboard.on('emotion:shifted', onEmotionShifted);
        this.blackboard.on('completed', onCompleted);

        await new Promise<void>(resolve => {
            if (this.stopped) return resolve();
            this.blackboard.once('completed', resolve);
        });

        this.blackboard.off('task:updated', onTaskUpdated);
        this.blackboard.off('loop:detected', onLoopDetected);
        this.blackboard.off('emotion:shifted', onEmotionShifted);
        this.blackboard.off('completed', onCompleted);
    }

    private async evaluate(trigger: string): Promise<void> {
        if (this.stopped) return;

        const snapshot = this.blackboard.snapshot();
        this.lastEvaluatedIteration = snapshot.taskState.iteration;

        // 報酬追跡: 連続成功/失敗カウンターを更新
        this.updateRewardTracker(snapshot);

        try {
            const structuredLLM = this.model.withStructuredOutput(MetaOutputSchema, {
                name: 'MetaCognition',
            });

            const recentCalls = snapshot.taskState.recentToolCalls.slice(-10);
            const toolCallsSummary = recentCalls.map((r, i) =>
                `${i + 1}. ${r.toolName}(${JSON.stringify(r.args).substring(0, 80)}): ${r.success ? '成功' : `失敗 [${r.failureType ?? 'unknown'}]`} — ${r.message.substring(0, 100)}`,
            ).join('\n');

            const failureRate = recentCalls.length > 0
                ? recentCalls.filter(r => !r.success).length / recentCalls.length
                : 0;

            const rewardInfo = this.formatRewardInfo();

            const userPrompt = [
                `# 現在の状況`,
                `- 目標: ${snapshot.goal}`,
                `- イテレーション: ${snapshot.taskState.iteration}`,
                `- 経過時間: ${Math.round(snapshot.elapsedMs / 1000)}秒`,
                `- 現在のモデル: ${this.modelSelector.modelName}`,
                `- 成功/失敗: ${snapshot.taskState.totalSuccesses}/${snapshot.taskState.totalFailures}`,
                `- 直近の失敗率: ${Math.round(failureRate * 100)}%`,
                `- 連続成功: ${this.reward.consecutiveSuccesses}回`,
                `- 連続失敗: ${this.reward.consecutiveFailures}回`,
                rewardInfo ? `- 報酬シグナル: ${rewardInfo}` : '',
                `- 評価トリガー: ${trigger}`,
                snapshot.emotionState ? `- 現在の感情: ${snapshot.emotionState.emotion}` : '',
                snapshot.taskState.currentThinking ? `- 最新の思考: ${snapshot.taskState.currentThinking.substring(0, 200)}` : '',
                '',
                `# 直近のツール呼び出し履歴`,
                toolCallsSummary || '(まだなし)',
            ].filter(Boolean).join('\n');

            const response = await structuredLLM.invoke([
                { role: 'system', content: META_SYSTEM_PROMPT },
                { role: 'user', content: userPrompt },
            ]);

            logger.info(
                `[MetaCognition] 🧠 評価: ${response.assessment} | model: ${response.modelAction} | stop: ${response.shouldStop} | streak: +${this.reward.consecutiveSuccesses}/-${this.reward.consecutiveFailures} — ${response.reasoning}`,
                'cyan',
            );

            const metaState: MetaState = {
                assessment: response.assessment as MetaAssessment,
                suggestion: response.suggestion,
                modelAction: response.modelAction as 'escalate' | 'deescalate' | 'hold',
                shouldStop: response.shouldStop,
                timestamp: Date.now(),
            };

            this.blackboard.updateMeta(metaState);
            this.applyDecision(metaState);
        } catch (error) {
            logger.error('[MetaCognition] evaluate error:', error);
        }
    }

    private applyDecision(meta: MetaState): void {
        // モデルエスカレーション/デエスカレーション
        if (meta.modelAction === 'escalate') {
            this.modelSelector.escalate('MetaCognition: ' + (meta.suggestion || meta.assessment));
        } else if (meta.modelAction === 'deescalate') {
            this.modelSelector.deescalate('MetaCognition: ' + (meta.suggestion || meta.assessment));
        }

        // wrong_approach / stuck で方針変更が必要な場合、実行中スキルを中断
        if ((meta.assessment === 'wrong_approach' || meta.assessment === 'stuck') && this.interruptCallback) {
            logger.warn(`[MetaCognition] ⚡ ${meta.assessment} → 実行中スキルを中断`);
            this.interruptCallback();
        }

        // 連続失敗による自動エスカレーション（LLM判断を補完）
        if (this.reward.consecutiveFailures >= 5 && meta.modelAction !== 'escalate') {
            logger.warn(`[MetaCognition] ⚡ 連続失敗${this.reward.consecutiveFailures}回 → 自動エスカレーション`);
            this.modelSelector.escalate('RewardTracker: 連続失敗5+');
        }

        // 連続成功による自動デエスカレーション（コスト最適化）
        if (this.reward.consecutiveSuccesses >= 8 && meta.modelAction !== 'deescalate') {
            logger.info(`[MetaCognition] 💰 連続成功${this.reward.consecutiveSuccesses}回 → 自動デエスカレーション`);
            this.modelSelector.deescalate('RewardTracker: 連続成功8+');
        }

        // フィードバック注入
        if (meta.suggestion && this.feedbackCallback) {
            this.feedbackCallback(`[メタ認知] ${meta.suggestion}`);
        }

        // タスク停止
        if (meta.shouldStop) {
            logger.warn('[MetaCognition] ⛔ タスク停止を判断');
            this.blackboard.complete();
        }
    }

    /**
     * 直近のツール実行結果に基づいて連続成功/失敗カウンターを更新する。
     */
    private updateRewardTracker(snapshot: ReturnType<CognitiveBlackboard['snapshot']>): void {
        const recentCalls = snapshot.taskState.recentToolCalls;
        if (recentCalls.length === 0) return;

        // カウンターを再計算（末尾から連続を数える）
        let consecutiveSuccesses = 0;
        let consecutiveFailures = 0;

        for (let i = recentCalls.length - 1; i >= 0; i--) {
            if (recentCalls[i].success) {
                if (consecutiveFailures > 0) break;
                consecutiveSuccesses++;
            } else {
                if (consecutiveSuccesses > 0) break;
                consecutiveFailures++;
            }
        }

        // 前回との差分で報酬シグナルを生成
        const prevSuccesses = this.reward.consecutiveSuccesses;
        const prevFailures = this.reward.consecutiveFailures;

        if (consecutiveSuccesses > prevSuccesses && prevFailures > 0) {
            // 失敗からの回復 → 正の予測誤差（ドーパミン放出）
            this.reward.recentRewardSignals.push({
                type: 'positive',
                magnitude: Math.min(prevFailures, 5),
                iteration: snapshot.taskState.iteration,
            });
        } else if (consecutiveFailures > prevFailures && prevSuccesses > 0) {
            // 成功からの失敗 → 負の予測誤差
            this.reward.recentRewardSignals.push({
                type: 'negative',
                magnitude: Math.min(prevSuccesses, 5),
                iteration: snapshot.taskState.iteration,
            });
        }

        // 直近10件のみ保持
        if (this.reward.recentRewardSignals.length > 10) {
            this.reward.recentRewardSignals = this.reward.recentRewardSignals.slice(-10);
        }

        this.reward.consecutiveSuccesses = consecutiveSuccesses;
        this.reward.consecutiveFailures = consecutiveFailures;
    }

    private formatRewardInfo(): string {
        const signals = this.reward.recentRewardSignals;
        if (signals.length === 0) return '';

        const positiveCount = signals.filter(s => s.type === 'positive').length;
        const negativeCount = signals.filter(s => s.type === 'negative').length;
        const latest = signals[signals.length - 1];

        return `${latest.type === 'positive' ? '↑' : '↓'}(正${positiveCount}/負${negativeCount})`;
    }
}

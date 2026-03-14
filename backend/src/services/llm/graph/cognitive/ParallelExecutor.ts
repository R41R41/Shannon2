import { StructuredTool } from '@langchain/core/tools';
import { TaskTreeState } from '@shannon/common';
import { BaseMessage } from '@langchain/core/messages';
import { logger } from '../../../../utils/logger.js';
import { EmotionNode, EmotionState } from '../nodes/EmotionNode.js';
import { FunctionCallingAgent, FunctionCallingAgentState } from '../nodes/FunctionCallingAgent.js';
import { CognitiveBlackboard } from './CognitiveBlackboard.js';
import { EmotionLoop } from './EmotionLoop.js';
import { MetaCognitionLoop } from './MetaCognitionLoop.js';
import { ModelSelector } from './ModelSelector.js';
import { TaskEpisodeMemory } from './TaskEpisodeMemory.js';
import { SelfImprovementDaemon } from './selfImprove/index.js';
import type { ExecutionResult } from '../types.js';
import { craftPlanToPlanState } from '../nodes/CraftPreflightNode.js';

/**
 * ParallelExecutor — 認知プロセスのオーケストレーター。
 *
 * 感情（EmotionLoop）、メタ認知（MetaCognitionLoop）、タスク実行（FCA）を
 * 並列に起動し、CognitiveBlackboard を通じて連携させる。
 *
 * Minecraft 単純タスクでは EmotionLoop + MetaCognitionLoop をスキップし、
 * 軽量な自動エスカレーションのみ行う（速度優先）。
 */

/** MetaCognition なしの自動エスカレーション閾値 */
const AUTO_ESCALATE_CONSECUTIVE_FAILURES = 5;

export interface ParallelExecutorDeps {
    fca: FunctionCallingAgent;
    emotionNode: EmotionNode;
}

export interface ParallelExecutorResult {
    taskTree: TaskTreeState;
    recoveryStatus?: 'idle' | 'awaiting_user' | 'failed_terminal';
    recoveryAttempts?: number;
    lastFailureType?: string;
    isEmergency?: boolean;
    messages: BaseMessage[];
    forceStop: boolean;
    finalEmotion?: import('@shannon/common').EmotionType | null;
    modelStats?: { escalations: number; deescalations: number; currentModel: string };
    /** ユーザー向け応答文（task-complete 時の最後の assistant content）。finalAnswer の優先元 */
    lastAssistantContent?: string;
}

export class ParallelExecutor {
    private fca: FunctionCallingAgent;
    private emotionNode: EmotionNode;

    constructor(deps: ParallelExecutorDeps) {
        this.fca = deps.fca;
        this.emotionNode = deps.emotionNode;
    }

    async run(
        state: FunctionCallingAgentState,
        signal?: AbortSignal,
    ): Promise<ParallelExecutorResult> {
        const goal = state.userMessage || 'Unknown task';
        const startTime = Date.now();
        const isMinecraft = state.context?.platform === 'minecraft' || state.context?.platform === 'minebot';

        // Minecraft 単純タスクでは認知ループをスキップ（速度優先）
        const skipEmotionLoop = isMinecraft;
        const skipMetaCognition = isMinecraft
            && state.needsPlanning === false
            && !state.isEmergency;

        // ModelSelector を初期化
        const modelSelector = new ModelSelector(state.selectedModel || FunctionCallingAgent.MODEL_NAME);

        // CognitiveBlackboard を初期化
        const blackboard = new CognitiveBlackboard(
            goal,
            state.emotionState.current,
            state.messages,
        );

        // Minecraft の場合、初期インベントリを blackboard にセット
        if (isMinecraft) {
            const mcMeta = state.context?.metadata?.minecraft as Record<string, unknown> | undefined;
            if (Array.isArray(mcMeta?.inventory)) {
                blackboard.updateInventory(mcMeta!.inventory as Array<{ name: string; count: number }>);
            }
        }

        // CraftPreflight の結果をプランとして blackboard に注入
        if (state.craftPlan) {
            const planState = craftPlanToPlanState(state.craftPlan, goal);
            blackboard.updatePlan(planState);
            logger.info(
                `[ParallelExecutor] 📋 初期プラン注入: ${planState.subtasks.length}サブタスク (${planState.strategy.substring(0, 60)})`,
            );
        }

        // 認知プロセスを条件付きで生成
        const emotionLoop = skipEmotionLoop
            ? null
            : new EmotionLoop(blackboard, this.emotionNode);
        const metaLoop = skipMetaCognition
            ? null
            : new MetaCognitionLoop(blackboard, modelSelector);

        // MetaCognitionLoop のフィードバックを FCA に注入
        if (metaLoop) {
            metaLoop.setFeedbackCallback((feedback) => {
                this.fca.addFeedback(feedback);
            });

            // MetaCognition が wrong_approach/stuck を判定した場合、実行中スキルを中断
            if (state.onRequestSkillInterrupt) {
                metaLoop.setInterruptCallback(state.onRequestSkillInterrupt);
            }
        }

        // FCA の TaskTreePublisher に blackboard アクセサを設定（Minebot UI に metaState/emotion を付加）
        this.fca.setBlackboardAccessor(() => ({
            metaState: blackboard.metaState,
            emotionState: blackboard.emotionState,
        }));

        // FCA の onToolsExecuted を拡張して blackboard を更新
        const originalOnToolsExecuted = state.onToolsExecuted;
        const wrappedState: FunctionCallingAgentState = {
            ...state,
            selectedModel: modelSelector.modelName,
            onToolsExecuted: (messages: BaseMessage[], results: ExecutionResult[]) => {
                // Blackboard にタスク状態を書き込み
                blackboard.updateTask({
                    iteration: blackboard.taskState.iteration + 1,
                    newResults: results,
                });

                // Plan: 現在のサブタスクのイテレーション数をインクリメント
                blackboard.incrementSubtaskIteration();

                // MetaCognition スキップ時: 軽量な自動エスカレーション
                if (skipMetaCognition) {
                    this.checkAutoEscalation(blackboard, modelSelector);
                }

                // EmotionLoop が未起動の場合のフォールバック
                if (!emotionLoop) {
                    originalOnToolsExecuted?.(messages, results);
                }
            },
        };

        const activeLoops: string[] = ['TaskExecution'];
        if (emotionLoop) activeLoops.push('Emotion');
        if (metaLoop) activeLoops.push('MetaCognition');
        logger.info(
            `[ParallelExecutor] 🧠 ${activeLoops.length}プロセス起動: ${activeLoops.join(' + ')} (model=${modelSelector.modelName})`,
            'cyan',
        );

        // 外部 signal と blackboard を連携
        if (signal) {
            signal.addEventListener('abort', () => blackboard.complete(), { once: true });
        }

        // プロセスを並列起動
        const taskPromise = this.fca.run(wrappedState, blackboard.signal);
        const emotionPromise = emotionLoop?.run() ?? Promise.resolve();
        const metaPromise = metaLoop?.run() ?? Promise.resolve();

        // TaskLoop の完了を待つ
        let taskResult: Awaited<typeof taskPromise>;
        try {
            taskResult = await taskPromise;
        } finally {
            // TaskLoop 完了後、他のプロセスに停止シグナルを送る
            blackboard.complete();
            // blackboard アクセサをクリア
            this.fca.setBlackboardAccessor(null);
        }

        // Emotion/Meta の終了を待つ（タイムアウト付き）
        await Promise.race([
            Promise.allSettled([emotionPromise, metaPromise]),
            new Promise(resolve => setTimeout(resolve, 3000)),
        ]);

        logger.info(
            `[ParallelExecutor] ✅ 完了 (model: ${modelSelector.stats.currentModel}, ` +
            `escalations: ${modelSelector.stats.escalations}, ` +
            `deescalations: ${modelSelector.stats.deescalations})`,
        );

        // エピソード記憶の保存（fire-and-forget）
        try {
            const platform = state.context?.platform ?? 'unknown';
            const episode = TaskEpisodeMemory.buildEpisodeFromResult(
                goal,
                platform,
                taskResult.taskTree,
                startTime,
                blackboard.taskState.iteration,
            );
            TaskEpisodeMemory.getInstance().saveEpisode(episode).catch(() => {});

            // 自己改善デーモンに通知（fire-and-forget）
            SelfImprovementDaemon.getInstance()
                .onEpisodeSaved(episode, blackboard.snapshot())
                .catch(() => {});
        } catch { }

        return {
            ...taskResult,
            finalEmotion: blackboard.emotionState,
            modelStats: modelSelector.stats,
        };
    }

    /**
     * MetaCognition 非使用時の軽量自動エスカレーション。
     * 連続失敗が閾値を超えた場合にモデルをエスカレーションする。
     */
    private checkAutoEscalation(
        blackboard: CognitiveBlackboard,
        modelSelector: ModelSelector,
    ): void {
        const recent = blackboard.taskState.recentToolCalls;
        if (recent.length < AUTO_ESCALATE_CONSECUTIVE_FAILURES) return;

        // 末尾から連続失敗をカウント
        let consecutiveFailures = 0;
        for (let i = recent.length - 1; i >= 0; i--) {
            if (!recent[i].success) {
                consecutiveFailures++;
            } else {
                break;
            }
        }

        if (consecutiveFailures >= AUTO_ESCALATE_CONSECUTIVE_FAILURES) {
            logger.warn(
                `[ParallelExecutor] ⚡ 連続失敗${consecutiveFailures}回 → 自動エスカレーション`,
            );
            modelSelector.escalate(`AutoEscalation: ${consecutiveFailures} consecutive failures`);
        }
    }
}

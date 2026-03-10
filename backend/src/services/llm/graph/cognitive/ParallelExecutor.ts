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
import type { ExecutionResult } from '../types.js';

/**
 * ParallelExecutor — 3並列プロセスのオーケストレーター。
 *
 * 感情（EmotionLoop）、メタ認知（MetaCognitionLoop）、タスク実行（FCA）を
 * 並列に起動し、CognitiveBlackboard を通じて連携させる。
 *
 * タスク実行が完了したら他のプロセスも停止する。
 */

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

        // ModelSelector を初期化
        const modelSelector = new ModelSelector(state.selectedModel || FunctionCallingAgent.MODEL_NAME);

        // CognitiveBlackboard を初期化
        const blackboard = new CognitiveBlackboard(
            goal,
            state.emotionState.current,
            state.messages,
        );

        // 3つの並列プロセスを生成
        const emotionLoop = new EmotionLoop(blackboard, this.emotionNode);
        const metaLoop = new MetaCognitionLoop(blackboard, modelSelector);

        // MetaCognitionLoop のフィードバックを FCA に注入
        metaLoop.setFeedbackCallback((feedback) => {
            this.fca.addFeedback(feedback);
        });

        // MetaCognition が wrong_approach/stuck を判定した場合、実行中スキルを中断
        if (state.onRequestSkillInterrupt) {
            metaLoop.setInterruptCallback(state.onRequestSkillInterrupt);
        }

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

                // 元の onToolsExecuted は呼ばない（EmotionLoop が代わりに処理する）
                // ただし、EmotionLoop が未起動の場合のフォールバック
                if (!emotionLoop) {
                    originalOnToolsExecuted(messages, results);
                }
            },
        };

        logger.info(
            `[ParallelExecutor] 🧠 3並列プロセス起動: Emotion + MetaCognition + TaskExecution (model=${modelSelector.modelName})`,
            'cyan',
        );

        // 外部 signal と blackboard を連携
        if (signal) {
            signal.addEventListener('abort', () => blackboard.complete(), { once: true });
        }

        // 3プロセスを並列起動
        const taskPromise = this.fca.run(wrappedState, blackboard.signal);
        const emotionPromise = emotionLoop.run();
        const metaPromise = metaLoop.run();

        // TaskLoop の完了を待つ
        let taskResult: Awaited<typeof taskPromise>;
        try {
            taskResult = await taskPromise;
        } finally {
            // TaskLoop 完了後、他のプロセスに停止シグナルを送る
            blackboard.complete();
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
        } catch { }

        return {
            ...taskResult,
            finalEmotion: blackboard.emotionState,
            modelStats: modelSelector.stats,
        };
    }
}

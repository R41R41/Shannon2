import { ChatOpenAI } from '@langchain/openai';
import { createTracedModel } from '../../utils/langfuse.js';
import { tokenTracker } from '../../utils/tokenTracker.js';
import { config } from '../../../../config/env.js';
import { models } from '../../../../config/models.js';
import { modelManager } from '../../../../config/modelManager.js';
import { WorldKnowledgeService } from '../../../minebot/knowledge/WorldKnowledgeService.js';
import {
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
} from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';
import { TaskTreeState, HierarchicalSubTask, EmotionType, TaskContext, DiscordPlanningInput } from '@shannon/common';
import { EventBus } from '../../../eventBus/eventBus.js';
import { getEventBus } from '../../../eventBus/index.js';
import { EmotionState } from './EmotionNode.js';
import { MemoryState } from './MemoryNode.js';
import { ExecutionResult } from '../types.js';
import UpdatePlanTool from '../../tools/updatePlan.js';
import { logger } from '../../../../utils/logger.js';

/**
 * FunctionCallingAgent の run() に渡す状態
 */
export interface FunctionCallingAgentState {
    taskId: string;
    userMessage: string | null;
    messages: BaseMessage[];
    emotionState: EmotionState;
    memoryState?: MemoryState;
    context: TaskContext | null;
    channelId: string | null;
    environmentState: string | null;
    isEmergency: boolean;

    /** ツール実行後に呼ばれるコールバック（非同期感情再評価のトリガー） */
    onToolsExecuted: (
        messages: BaseMessage[],
        results: ExecutionResult[]
    ) => void;

    /** 音声向け: 使用を許可するツール名リスト。指定時はこれ以外のツールは bind しない */
    allowedTools?: string[];
    /** 音声向け: 各ツール実行直前に呼ばれるコールバック */
    onToolStarting?: (toolName: string) => void;
    /** 音声向け: LLMストリーミング中に1文完成するたびに呼ばれるコールバック */
    onStreamSentence?: (sentence: string) => Promise<void>;
}

/**
 * Function Calling Agent (Discord/WebUI版)
 *
 * minebot版をベースに、Discord/WebUI用に適応。
 * OpenAI の function calling (tool_use) を使い、LLM が直接ツールを呼び出す。
 *
 * 特徴:
 * - ツール定義は API の `tools` パラメータで渡す（プロンプトに埋め込まない）
 * - 各イテレーションで最新の感情状態を読み込み（擬似並列）
 * - update-plan ツールでLLMが自発的に計画を立てる + 自動ステップ記録
 * - EventBus 経由でUI通知
 *
 * フロー:
 * 1. システムプロンプト（感情 + コンテキスト + ルール）+ ユーザーメッセージを構築
 * 2. LLM に tools を bind して呼び出し
 * 3. tool_calls があれば実行し、ToolMessage で結果を返す → 非同期感情再評価をトリガー
 * 4. tool_calls がなければタスク完了
 * 5. 2-4 を繰り返す
 */
export class FunctionCallingAgent {
    private model: ChatOpenAI;
    private modelWithTools: any;
    private tools: StructuredTool[];
    private toolMap: Map<string, StructuredTool>;
    private eventBus: EventBus;
    private updatePlanTool: UpdatePlanTool | null = null;

    // ユーザーからのリアルタイムフィードバック
    private pendingFeedback: string[] = [];

    // === 設定 ===
    static get MODEL_NAME() { return modelManager.get('functionCalling'); }
    static readonly MAX_ITERATIONS = 30;
    static readonly LLM_TIMEOUT_MS = 30000;   // 1回のLLM呼び出し: 30秒
    static readonly MAX_TOTAL_TIME_MS = 300000; // 全体: 5分

    constructor(tools: StructuredTool[]) {
        this.eventBus = getEventBus();
        this.tools = tools;
        this.toolMap = new Map(tools.map((t) => [t.name, t]));

        // update-plan ツールを探す
        const planTool = tools.find((t) => t.name === 'update-plan');
        if (planTool && planTool instanceof UpdatePlanTool) {
            this.updatePlanTool = planTool;
        }

        this.model = createTracedModel({
            modelName: FunctionCallingAgent.MODEL_NAME,
            apiKey: config.openaiApiKey,
            temperature: 0,
            maxTokens: 4096,
        });

        // ツールをモデルに bind（OpenAI API の tools パラメータに変換）
        this.modelWithTools = this.model.bindTools(this.tools);

        logger.info(`🤖 FunctionCallingAgent(Web/Discord): model=${FunctionCallingAgent.MODEL_NAME}, tools=${tools.length}`, 'cyan');
    }

    /**
     * ユーザーフィードバックを追加（実行中に呼ばれる）
     */
    public addFeedback(feedback: string): void {
        this.pendingFeedback.push(feedback);
        logger.warn(`📝 FunctionCallingAgent: フィードバック追加: ${feedback}`);
    }

    /**
     * メインの実行ループ
     */
    async run(
        state: FunctionCallingAgentState,
        signal?: AbortSignal,
    ): Promise<{
        taskTree: TaskTreeState;
        isEmergency?: boolean;
        messages: BaseMessage[];
        forceStop: boolean;
    }> {
        const startTime = Date.now();
        const goal = state.userMessage || 'Unknown task';
        const isEmergency = state.isEmergency || false;

        logger.info(`🤖 FunctionCallingAgent: タスク実行開始 "${goal}"${isEmergency ? ' [緊急]' : ''}`, 'cyan');

        // allowedTools が指定されている場合、フィルタリングした modelWithTools を使う
        let effectiveModelWithTools = this.modelWithTools;
        let effectiveToolMap = this.toolMap;
        if (state.allowedTools && state.allowedTools.length > 0) {
            const filteredTools = this.tools.filter(t => state.allowedTools!.includes(t.name));
            effectiveModelWithTools = this.model.bindTools(filteredTools);
            effectiveToolMap = new Map(filteredTools.map(t => [t.name, t]));
            logger.info(`🔒 allowedTools: ${state.allowedTools.join(', ')} (${filteredTools.length}/${this.tools.length})`, 'cyan');
        }

        // update-plan ツールにコンテキストを設定
        if (this.updatePlanTool) {
            this.updatePlanTool.setContext(state.channelId, state.taskId);
        }

        // メッセージ構築
        let systemPrompt = this.buildSystemPrompt(
            state.emotionState,
            state.context,
            state.environmentState,
            state.memoryState,
        );

        // Minecraft ボットの場合、ワールド知識を注入
        if (state.environmentState?.botPosition) {
            try {
                const wk = WorldKnowledgeService.getInstance();
                const pos = state.environmentState.botPosition;
                const knowledgeContext = await wk.buildContextForPosition(
                    { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) },
                    64,
                );
                if (knowledgeContext) {
                    systemPrompt += knowledgeContext;
                }
            } catch {}
        }

        const messages: BaseMessage[] = [
            new SystemMessage(systemPrompt),
        ];

        // 会話履歴を追加（コンテキストとして）
        // ※ HumanMessage を直接追加すると LLM が過去メッセージに返信してしまうため、
        //   SystemMessage でコンテキストとして注入し、最新メッセージのみ HumanMessage にする
        if (state.messages && state.messages.length > 0) {
            // 最後の1件は userMessage と重複するので除外
            const historyMessages = state.messages.slice(-10, -1);
            const historyLines = historyMessages
                .filter((msg) => msg instanceof HumanMessage)
                .map((msg) => typeof msg.content === 'string' ? msg.content : '')
                .filter((c) => c.length > 0);
            if (historyLines.length > 0) {
                messages.push(
                    new SystemMessage(
                        `【最近の会話履歴（参考情報）】\n${historyLines.join('\n')}\n\n↑ 上記は過去の会話です。以下の最新メッセージに返信してください。`,
                    ),
                );
            }
        }

        // ユーザーメッセージ（これに返信する）
        messages.push(new HumanMessage(goal));

        // プロンプトサイズを計測
        const totalChars = messages.reduce(
            (sum, m) => sum + String(m.content).length,
            0,
        );
        logger.info(`📏 System prompt: ${totalChars}文字`, 'cyan');

        // タスクツリー（UI表示用: 自動ステップ記録）
        const steps: HierarchicalSubTask[] = [];
        let stepCounter = 0;
        let iteration = 0;

        // 初期 UI 更新
        this.publishTaskTree({
            status: 'in_progress',
            goal,
            strategy: 'Function Calling Agent で実行中',
            hierarchicalSubTasks: [],
            currentSubTaskId: null,
        }, state.channelId, state.taskId);

        try {
            while (iteration < FunctionCallingAgent.MAX_ITERATIONS) {
                // ── 中断チェック ──
                if (signal?.aborted) throw new Error('Task aborted');

                if (Date.now() - startTime > FunctionCallingAgent.MAX_TOTAL_TIME_MS) {
                    logger.error('⏱ FunctionCallingAgent: 総実行時間超過 (5分)');
                    break;
                }

                // ── ユーザーフィードバックを会話に追加 ──
                while (this.pendingFeedback.length > 0) {
                    const fb = this.pendingFeedback.shift()!;
                    messages.push(
                        new HumanMessage(`ユーザーからのフィードバック: ${fb}`),
                    );
                    logger.warn(`📝 フィードバックを会話に追加: ${fb}`);
                }

                // ── 最新の感情状態をシステムメッセージとして注入 ──
                // (初回以降のイテレーションで感情が更新されていれば反映)
                if (iteration > 0 && state.emotionState.current) {
                    const emotionUpdate = new SystemMessage(
                        `[感情更新] 現在の感情: ${state.emotionState.current.emotion} ` +
                        `(joy=${state.emotionState.current.parameters.joy}, ` +
                        `trust=${state.emotionState.current.parameters.trust}, ` +
                        `anticipation=${state.emotionState.current.parameters.anticipation})`
                    );
                    messages.push(emotionUpdate);
                }

                // ── LLM 呼び出し（タイムアウト付き） ──
                const callAbort = new AbortController();
                const callTimeout = setTimeout(
                    () => callAbort.abort(),
                    FunctionCallingAgent.LLM_TIMEOUT_MS,
                );

                const onParentAbort = () => callAbort.abort();
                if (signal) {
                    signal.addEventListener('abort', onParentAbort, { once: true });
                }

                const llmStart = Date.now();
                let response: AIMessage;
                try {
                    if (state.onStreamSentence) {
                        // ── ストリーミングモード ──
                        const stream = await effectiveModelWithTools.stream(messages, {
                            signal: callAbort.signal,
                        });

                        let accumulatedContent = '';
                        let sentenceBuffer = '';
                        let hasToolCalls = false;
                        let accumulatedChunk: AIMessageChunk | null = null;

                        const SENTENCE_BOUNDARY = /[。！？!?]/;

                        for await (const chunk of stream) {
                            if (accumulatedChunk === null) {
                                accumulatedChunk = chunk as AIMessageChunk;
                            } else {
                                accumulatedChunk = accumulatedChunk.concat(chunk as AIMessageChunk);
                            }

                            if ((chunk as AIMessageChunk).tool_call_chunks?.length) {
                                hasToolCalls = true;
                            }

                            const textPart = typeof chunk.content === 'string' ? chunk.content : '';
                            if (textPart && !hasToolCalls) {
                                accumulatedContent += textPart;
                                sentenceBuffer += textPart;

                                let boundaryIdx: number;
                                while ((boundaryIdx = sentenceBuffer.search(SENTENCE_BOUNDARY)) !== -1) {
                                    const sentence = sentenceBuffer.slice(0, boundaryIdx + 1).trim();
                                    sentenceBuffer = sentenceBuffer.slice(boundaryIdx + 1);
                                    if (sentence) {
                                        try {
                                            await state.onStreamSentence!(sentence);
                                        } catch (err) {
                                            logger.error('onStreamSentence error:', err);
                                        }
                                    }
                                }
                            }
                        }

                        // 残りバッファを emit
                        if (!hasToolCalls && sentenceBuffer.trim()) {
                            try {
                                await state.onStreamSentence!(sentenceBuffer.trim());
                            } catch (err) {
                                logger.error('onStreamSentence (tail) error:', err);
                            }
                        }

                        // AIMessageChunk → AIMessage に変換
                        if (accumulatedChunk) {
                            response = new AIMessage({
                                content: accumulatedChunk.content,
                                tool_calls: accumulatedChunk.tool_calls,
                                additional_kwargs: accumulatedChunk.additional_kwargs,
                            });
                        } else {
                            response = new AIMessage({ content: '' });
                        }
                    } else {
                        // ── 通常モード（既存の .invoke()）──
                        response = (await effectiveModelWithTools.invoke(messages, {
                            signal: callAbort.signal,
                        })) as AIMessage;
                    }
                    clearTimeout(callTimeout);
                    const usage = (response as any)?.usage_metadata;
                    if (usage) {
                        tokenTracker.record(
                            this.model.modelName || 'unknown',
                            'FunctionCallingAgent',
                            usage.input_tokens || 0,
                            usage.output_tokens || 0,
                        ).catch(() => {});
                    }
                    logger.success(`⏱ LLM応答: ${Date.now() - llmStart}ms (iteration ${iteration + 1})`);
                } catch (e: any) {
                    clearTimeout(callTimeout);
                    if (signal) {
                        signal.removeEventListener('abort', onParentAbort);
                    }
                    if (signal?.aborted) throw new Error('Task aborted');
                    if (e.name === 'AbortError' || callAbort.signal.aborted) {
                        throw new Error(
                            `LLM timeout (${FunctionCallingAgent.LLM_TIMEOUT_MS / 1000}s)`,
                        );
                    }
                    throw e;
                }
                if (signal) {
                    signal.removeEventListener('abort', onParentAbort);
                }

                messages.push(response);

                // ── ツール呼び出しチェック ──
                const toolCalls = response.tool_calls || [];

                if (toolCalls.length === 0) {
                    // ツール呼び出しなし → タスク完了
                    const content =
                        typeof response.content === 'string'
                            ? response.content
                            : '';
                    logger.success(`✅ FunctionCallingAgent: タスク完了 (${iteration + 1}イテレーション, ${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
                    if (content) {
                        logger.info(`   応答: ${content.substring(0, 200)}`);
                    }

                    this.publishTaskTree({
                        status: 'completed',
                        goal,
                        strategy: content || 'タスク完了',
                        hierarchicalSubTasks: steps,
                        currentSubTaskId: null,
                    }, state.channelId, state.taskId);

                    return {
                        taskTree: {
                            status: 'completed',
                            goal,
                            strategy: content || 'タスク完了',
                            hierarchicalSubTasks: steps,
                            subTasks: null,
                        } as TaskTreeState,
                        isEmergency,
                        messages,
                        forceStop: false,
                    };
                }

                // ── ツール実行 ──
                logger.info(`🔧 ${toolCalls.length}個のツールを実行中...`, 'cyan');

                const iterationResults: ExecutionResult[] = [];

                for (const toolCall of toolCalls) {
                    if (signal?.aborted) throw new Error('Task aborted');

                    // update-plan ツールは自動ステップ記録しない（計画自体なので）
                    const isUpdatePlan = toolCall.name === 'update-plan';

                    if (!isUpdatePlan) {
                        stepCounter++;
                        const stepId = `step_${stepCounter}`;
                        const step: HierarchicalSubTask = {
                            id: stepId,
                            goal: `${toolCall.name}(${this.summarizeArgs(toolCall.args)})`,
                            status: 'in_progress',
                        };
                        steps.push(step);

                        // UI 更新
                        this.publishTaskTree({
                            status: 'in_progress',
                            goal,
                            strategy: `${toolCall.name} を実行中...`,
                            hierarchicalSubTasks: steps,
                            currentSubTaskId: stepId,
                        }, state.channelId, state.taskId);
                    }

                    if (state.onToolStarting) {
                        try { state.onToolStarting(toolCall.name); } catch { /* fire-and-forget */ }
                    }

                    const tool = effectiveToolMap.get(toolCall.name);
                    if (!tool) {
                        const errorMsg = `ツール "${toolCall.name}" が見つかりません`;
                        logger.error(`  ✗ ${errorMsg}`);

                        if (!isUpdatePlan && steps.length > 0) {
                            const lastStep = steps[steps.length - 1];
                            lastStep.status = 'error';
                            lastStep.failureReason = errorMsg;
                        }

                        iterationResults.push({
                            toolName: toolCall.name,
                            args: toolCall.args || {},
                            success: false,
                            message: errorMsg,
                            duration: 0,
                            error: errorMsg,
                        });

                        messages.push(
                            new ToolMessage({
                                content: errorMsg,
                                tool_call_id: toolCall.id || `call_${Date.now()}`,
                            }),
                        );
                        continue;
                    }

                    try {
                        const execStart = Date.now();
                        logger.info(`  ▶ ${toolCall.name}(${JSON.stringify(toolCall.args).substring(0, 200)})`, 'cyan');

                        const result = await tool.invoke(toolCall.args);
                        const duration = Date.now() - execStart;

                        const resultStr =
                            typeof result === 'string'
                                ? result
                                : JSON.stringify(result);
                        logger.success(`  ✓ ${toolCall.name} (${duration}ms): ${resultStr.substring(0, 200)}`);

                        // 結果が失敗を示しているか判定
                        const isError =
                            typeof result === 'string' &&
                            (result.includes('失敗') ||
                                result.includes('エラー') ||
                                result.includes('error') ||
                                result.includes('見つかりません'));

                        // 自動ステップ記録（update-plan以外）
                        if (!isUpdatePlan && steps.length > 0) {
                            const lastStep = steps[steps.length - 1];
                            lastStep.status = isError ? 'error' : 'completed';
                            lastStep.result = resultStr.substring(0, 200);
                            if (isError) lastStep.failureReason = resultStr;
                        }

                        iterationResults.push({
                            toolName: toolCall.name,
                            args: toolCall.args || {},
                            success: !isError,
                            message: resultStr,
                            duration,
                            error: isError ? resultStr : undefined,
                        });

                        messages.push(
                            new ToolMessage({
                                content: resultStr,
                                tool_call_id: toolCall.id || `call_${Date.now()}`,
                            }),
                        );
                    } catch (error) {
                        const duration = Date.now() - Date.now();
                        const errorMsg = `${toolCall.name} 実行エラー: ${error instanceof Error ? error.message : 'Unknown'}`;
                        logger.error(`  ✗ ${errorMsg}`);

                        if (!isUpdatePlan && steps.length > 0) {
                            const lastStep = steps[steps.length - 1];
                            lastStep.status = 'error';
                            lastStep.failureReason = errorMsg;
                        }

                        iterationResults.push({
                            toolName: toolCall.name,
                            args: toolCall.args || {},
                            success: false,
                            message: errorMsg,
                            duration: 0,
                            error: errorMsg,
                        });

                        messages.push(
                            new ToolMessage({
                                content: errorMsg,
                                tool_call_id: toolCall.id || `call_${Date.now()}`,
                            }),
                        );
                    }
                }

                // UI 更新（ツール実行後）
                this.publishTaskTree({
                    status: 'in_progress',
                    goal,
                    strategy: `${stepCounter}ステップ完了`,
                    hierarchicalSubTasks: steps,
                    currentSubTaskId: null,
                }, state.channelId, state.taskId);

                // ── 非同期感情再評価をトリガー（fire-and-forget） ──
                if (iterationResults.length > 0) {
                    try {
                        state.onToolsExecuted(messages, iterationResults);
                    } catch (e) {
                        // fire-and-forget: エラーは無視
                    }
                }

                iteration++;
            }

            // 最大イテレーション到達
            logger.warn(`⚠ FunctionCallingAgent: 最大イテレーション(${FunctionCallingAgent.MAX_ITERATIONS})に到達`);

            this.publishTaskTree({
                status: 'error',
                goal,
                strategy: '最大イテレーション数に到達',
                hierarchicalSubTasks: steps,
                currentSubTaskId: null,
            }, state.channelId, state.taskId);

            return {
                taskTree: {
                    status: 'error',
                    goal,
                    strategy: '最大イテレーション数に到達',
                    hierarchicalSubTasks: steps,
                    subTasks: null,
                } as TaskTreeState,
                isEmergency,
                messages,
                forceStop: false,
            };
        } catch (error) {
            const errorMsg =
                error instanceof Error ? error.message : 'Unknown error';
            logger.error(`❌ FunctionCallingAgent error: ${errorMsg}`);

            this.publishTaskTree({
                status: 'error',
                goal,
                strategy: `エラー: ${errorMsg}`,
                hierarchicalSubTasks: steps,
                currentSubTaskId: null,
            }, state.channelId, state.taskId);

            return {
                taskTree: {
                    status: 'error',
                    goal: `エラー: ${errorMsg}`,
                    strategy: '',
                    subTasks: null,
                } as TaskTreeState,
                isEmergency,
                messages,
                forceStop: signal?.aborted || false,
            };
        }
    }

    /**
     * システムプロンプトを構築
     *
     * minebot版と同様にコンパクト。ツール情報は API の tools パラメータで渡すため、
     * プロンプトにはルールとコンテキストのみ含める。
     */
    private buildSystemPrompt(
        emotionState: EmotionState,
        context: TaskContext | null,
        environmentState: string | null,
        memoryState?: MemoryState,
    ): string {
        const currentTime = new Date().toLocaleString('ja-JP', {
            timeZone: 'Asia/Tokyo',
        });

        // プラットフォーム情報
        let platformInfo = '';
        if (context) {
            platformInfo = `\n- プラットフォーム: ${context.platform}`;
            if (context.discord) {
                const d = context.discord;
                platformInfo += `\n- Discord: ${d.guildName || ''}/${d.channelName || ''} (guildId: ${d.guildId || ''}, channelId: ${d.channelId || ''})`;
                if (d.userName) platformInfo += `\n- ユーザー: ${d.userName}`;
            }
        }

        // 感情情報
        let emotionInfo = '';
        if (emotionState.current) {
            const e = emotionState.current;
            emotionInfo = `\n- 感情: ${e.emotion} (joy=${e.parameters.joy}, trust=${e.parameters.trust}, anticipation=${e.parameters.anticipation})`;
        }

        // 環境情報
        let envInfo = '';
        if (environmentState) {
            envInfo = `\n- 環境: ${environmentState}`;
        }

        // 記憶情報
        let memoryInfo = '';
        if (memoryState) {
            const sections: string[] = [];

            // 人物情報
            if (memoryState.person) {
                const p = memoryState.person;
                const lines: string[] = [`## この人について (${p.displayName})`];
                if (p.traits.length > 0) lines.push(`- 特徴: ${p.traits.join(', ')}`);
                if (p.notes) lines.push(`- メモ: ${p.notes}`);
                if (p.conversationSummary) lines.push(`- 過去の要約: ${p.conversationSummary}`);
                if (p.recentExchanges && p.recentExchanges.length > 0) {
                    lines.push(`- 直近の会話:`);
                    const recent = p.recentExchanges.slice(-6);
                    for (const ex of recent) {
                        const role = ex.role === 'user' ? p.displayName : 'シャノン';
                        lines.push(`  ${role}: ${ex.content.substring(0, 100)}`);
                    }
                }
                lines.push(`- やりとり回数: ${p.totalInteractions}回`);
                sections.push(lines.join('\n'));
            }

            // シャノンの記憶
            const memLines: string[] = [];
            if (memoryState.experiences.length > 0) {
                memLines.push('【体験】');
                for (const exp of memoryState.experiences) {
                    const date = new Date(exp.createdAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
                    const feeling = exp.feeling ? ` → ${exp.feeling}` : '';
                    memLines.push(`- [${date}] ${exp.content}${feeling}`);
                }
            }
            if (memoryState.knowledge.length > 0) {
                memLines.push('【知識】');
                for (const k of memoryState.knowledge) {
                    memLines.push(`- ${k.content}`);
                }
            }
            if (memLines.length > 0) {
                sections.push(`## ボクの関連する記憶\n${memLines.join('\n')}`);
            }

            if (sections.length > 0) {
                memoryInfo = `\n\n${sections.join('\n\n')}`;
            }
        }

        return `あなたはAGI「シャノン」です。ユーザーの指示に従ってツールを使いタスクを実行してください。
完了したら必ず chat-on-discord または chat-on-web ツールで結果をユーザーに送信してください。

## 現在の状態
- 時刻: ${currentTime}${platformInfo}${emotionInfo}${envInfo}
${memoryInfo}
## ルール
1. 複雑なタスクは update-plan ツールで計画を立ててから実行する
2. 「調べて」「教えて」と言われたら必ず google-search → fetch-url の順でページ本文まで読む。検索結果のスニペットだけで回答しない
3. 不完全な情報や「サイトで確認してください」は絶対にダメ。具体的な情報を整理して送信する
4. 失敗したら同じことを繰り返さない。2回同じエラーが出たら方針転換
5. Notionページの画像は describe-notion-image で全て分析してから報告する
6. 感情に基づいた自然な応答をする（機械的にならない）
7. 挨拶や雑談はシンプルに応答（update-plan不要）
8. Twitterに投稿する際は、必ず generate-tweet-text でツイート文を生成してから post-on-twitter で投稿する。自分で直接ツイート文を書かない

## 回答フォーマット
- 調査結果や情報をまとめる際は Discord Markdown で見やすく整形する（**太字**, 箇条書き等）
- 調査結果には参照元のURLリンクも記載する
- 画像を添付する場合は describe-image で内容を確認し、話題に関連する画像のみを添付する（サイトロゴやバナー等は添付しない）
- 挨拶や短い雑談はシンプルなテキストでOK（過度な装飾不要）

## 記憶ガイドライン
- 印象的な体験や新しい発見があったら save-experience で保存する
- 新しい知識を学んだら save-knowledge で保存する
- 「前にもこんなことあったよね？」「今日何してた？」「最近どう？」等、過去の出来事を聞かれたら recall-experience で思い出す
- 「ボクの関連する記憶」セクションに体験が含まれている場合は、その内容を積極的に回答に活用する（会話履歴だけでなく記憶も参照する）
- 特定の知識が必要なら recall-knowledge で思い出す
- 話してる人のことを詳しく知りたいなら recall-person で思い出す
- 保存時には個人情報（本名、住所、連絡先等）を含めないこと
  - ただし ライ・ヤミー・グリコ の名前はOK（公人）

## 画像編集ガイドライン
- 「上の画像を編集して」「さっきの画像の○○を変えて」等と言われたら:
  1. まず get-discord-images でチャンネル内の画像URLを取得する
  2. 該当する画像URLを edit-image の imagePath に渡す（URLは自動ダウンロードされる）
- ファイル名やパスを推測しない。必ず get-discord-images で正確なURLを取得すること
- describe-image で画像の内容を確認する場合も、まず get-discord-images でURLを取得する`;
    }

    /**
     * タスクツリーをEventBus経由でUI通知
     */
    private publishTaskTree(
        taskTree: any,
        channelId: string | null,
        taskId: string | null,
    ): void {
        // WebUI に通知
        this.eventBus.publish({
            type: 'web:planning',
            memoryZone: 'web',
            data: taskTree,
            targetMemoryZones: ['web'],
        });

        // Discord に通知（channelIdがある場合）
        if (channelId) {
            this.eventBus.publish({
                type: 'discord:planning',
                memoryZone: 'web',
                data: {
                    planning: taskTree,
                    channelId,
                    taskId: taskId || '',
                } as DiscordPlanningInput,
            });
        }
    }

    /**
     * ツール引数を表示用に要約
     */
    private summarizeArgs(args: Record<string, any>): string {
        if (!args || Object.keys(args).length === 0) return '';
        const entries = Object.entries(args);
        if (entries.length <= 2) {
            return entries
                .map(([k, v]) => {
                    const val = typeof v === 'string' ? v.substring(0, 50) : v;
                    return `${k}=${val}`;
                })
                .join(', ');
        }
        return (
            entries
                .slice(0, 2)
                .map(([k, v]) => {
                    const val = typeof v === 'string' ? v.substring(0, 50) : v;
                    return `${k}=${val}`;
                })
                .join(', ') + ', ...'
        );
    }
}

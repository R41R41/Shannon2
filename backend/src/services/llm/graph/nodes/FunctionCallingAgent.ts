import {
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
} from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { DiscordPlanningInput, HierarchicalSubTask, TaskContext, TaskTreeState } from '@shannon/common';
import { setMaxListeners } from 'node:events';
import { config } from '../../../../config/env.js';
import { modelManager } from '../../../../config/modelManager.js';
import { logger } from '../../../../utils/logger.js';
import { EventBus } from '../../../eventBus/eventBus.js';
import { getEventBus } from '../../../eventBus/index.js';
import { CONFIG as MINEBOT_CONFIG } from '../../../minebot/config/MinebotConfig.js';
import { WorldKnowledgeService } from '../../../minebot/knowledge/WorldKnowledgeService.js';
import UpdatePlanTool from '../../tools/updatePlan.js';
import { trimContext } from '../../utils/contextManager.js';
import { createTracedModel } from '../../utils/langfuse.js';
import { tokenTracker } from '../../utils/tokenTracker.js';
import { ExecutionResult } from '../types.js';
import { EmotionState } from './EmotionNode.js';
import { MemoryState } from './MemoryNode.js';

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
    /** Pre-formatted memory prompt from ScopedMemoryService (replaces memoryState when set) */
    memoryPrompt?: string;
    relationshipPrompt?: string;
    selfModelPrompt?: string;
    strategyPrompt?: string;
    internalStatePrompt?: string;
    worldModelPrompt?: string;

    /** ツール実行後に呼ばれるコールバック（非同期感情再評価のトリガー） */
    onToolsExecuted: (
        messages: BaseMessage[],
        results: ExecutionResult[]
    ) => void;

    /** 音声向け: 使用を許可するツール名リスト。指定時はこれ以外のツールは bind しない */
    allowedTools?: string[];
    /** 音声向け: 各ツール実行直前に呼ばれるコールバック */
    onToolStarting?: (toolName: string, args?: Record<string, unknown>) => void;
    /** Minebot UI 同期向け: taskTree 更新のたびに呼ばれるコールバック */
    onTaskTreeUpdate?: (taskTree: TaskTreeState) => void;
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

    // 思考過程の管理
    private thinkingTrace: string[] = [];
    private thinkingSummary: string = '';
    private static readonly THINKING_RAW_KEEP = 6;
    private static readonly THINKING_SUMMARIZE_THRESHOLD = 2000;

    // === 設定 ===
    static get MODEL_NAME() { return modelManager.get('functionCalling'); }
    static readonly MAX_ITERATIONS = 50;
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
            temperature: 1,
            maxTokens: 1024,
        });

        // ツールをモデルに bind（OpenAI API の tools パラメータに変換）
        this.modelWithTools = this.model.bindTools(this.tools);

        logger.info(`🤖 FunctionCallingAgent(Web/Discord): model=${FunctionCallingAgent.MODEL_NAME}, tools=${tools.length}`, 'cyan');
    }

    public addTools(tools: StructuredTool[]): void {
        let added = 0;
        for (const tool of tools) {
            if (this.toolMap.has(tool.name)) continue;
            this.tools.push(tool);
            this.toolMap.set(tool.name, tool);
            added += 1;
            if (tool.name === 'update-plan' && tool instanceof UpdatePlanTool) {
                this.updatePlanTool = tool;
            }
        }

        if (added > 0) {
            this.modelWithTools = this.model.bindTools(this.tools);
            logger.info(`🔧 FunctionCallingAgent: added ${added} tools (total=${this.tools.length})`, 'cyan');
        }
    }

    public getToolNames(): string[] {
        return [...this.toolMap.keys()];
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
        recoveryStatus?: 'idle' | 'awaiting_user' | 'failed_terminal';
        recoveryAttempts?: number;
        lastFailureType?: string;
        isEmergency?: boolean;
        messages: BaseMessage[];
        forceStop: boolean;
    }> {
        const startTime = Date.now();
        const goal = state.userMessage || 'Unknown task';
        const isEmergency = state.isEmergency || false;
        let activeCallAbort: AbortController | null = null;
        const onParentAbort = () => activeCallAbort?.abort();
        this.relaxAbortSignalListenerLimit(signal);

        this.resetThinkingState();
        logger.info(`🤖 FunctionCallingAgent: タスク実行開始 "${goal}"${isEmergency ? ' [緊急]' : ''}`, 'cyan');
        if (signal) {
            signal.addEventListener('abort', onParentAbort, { once: true });
        }

        // allowedTools が指定されている場合、フィルタリングした modelWithTools を使う
        let effectiveModelWithTools = this.modelWithTools;
        let effectiveToolMap = this.toolMap;
        if (state.allowedTools && state.allowedTools.length > 0) {
            const filteredTools = this.tools.filter(t => state.allowedTools!.includes(t.name));
            effectiveModelWithTools = this.model.bindTools(filteredTools);
            effectiveToolMap = new Map(filteredTools.map(t => [t.name, t]));
            logger.info(`🔒 allowedTools: ${state.allowedTools.join(', ')} (${filteredTools.length}/${this.tools.length})`, 'cyan');
        }

        const channelOutputTools = this.getDisabledOutputTools(state.context);
        if (channelOutputTools.length > 0) {
            const filteredTools = [...effectiveToolMap.values()].filter(
                (tool) => !channelOutputTools.includes(tool.name),
            );
            effectiveModelWithTools = this.model.bindTools(filteredTools);
            effectiveToolMap = new Map(filteredTools.map((tool) => [tool.name, tool]));
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
            state.memoryPrompt,
            state.relationshipPrompt,
            state.selfModelPrompt,
            state.strategyPrompt,
            state.internalStatePrompt,
            state.worldModelPrompt,
        );

        // Minecraft ボットの場合、ワールド知識を注入
        try {
            const envObj = state.environmentState ? JSON.parse(state.environmentState) : null;
            if (envObj?.botPosition) {
                const wk = WorldKnowledgeService.getInstance();
                const pos = envObj.botPosition;
                const knowledgeContext = await wk.buildContextForPosition(
                    { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) },
                    64,
                );
                if (knowledgeContext) {
                    systemPrompt += knowledgeContext;
                }
            }
        } catch { }

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
        let pendingRecoveryFailure: ExecutionResult | null = null;
        let lastRecoverableFailure: ExecutionResult | null = null;
        let forcedRecoveryAttempts = 0;
        let consecutiveTextOnly = 0;
        const MAX_CONSECUTIVE_TEXT_ONLY = 3;
        let lastThinkingContent: string | null = null;

        // 初期 UI 更新
        this.publishTaskTree({
            status: 'in_progress',
            goal,
            strategy: 'Function Calling Agent で実行中',
            hierarchicalSubTasks: [],
            currentSubTaskId: null,
        }, state.context?.platform ?? null, state.channelId, state.taskId, state.onTaskTreeUpdate);

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

                // ── コンテキストウィンドウのトリミング ──
                const trimmed = trimContext(messages, { maxContextTokens: 16000 });
                if (trimmed.length < messages.length) {
                    logger.debug(`コンテキストトリミング: ${messages.length} → ${trimmed.length} メッセージ`);
                    messages.length = 0;
                    messages.push(...trimmed);
                }

                // ── 一時的な思考/感情コンテキストを注入（LLM呼び出し後に除去） ──
                const ephemeralMessages: BaseMessage[] = [];
                if (iteration > 0 && (this.thinkingSummary || this.thinkingTrace.length > 0)) {
                    const thinkingContext = this.buildThinkingContext();
                    if (thinkingContext) {
                        const msg = new SystemMessage(thinkingContext);
                        ephemeralMessages.push(msg);
                    }
                }
                if (iteration > 0 && state.emotionState.current) {
                    const msg = new SystemMessage(
                        `[感情更新] 現在の感情: ${state.emotionState.current.emotion} ` +
                        `(joy=${state.emotionState.current.parameters.joy}, ` +
                        `trust=${state.emotionState.current.parameters.trust}, ` +
                        `anticipation=${state.emotionState.current.parameters.anticipation})`
                    );
                    ephemeralMessages.push(msg);
                }
                messages.push(...ephemeralMessages);

                // ── LLM 呼び出し（タイムアウト付き） ──
                const callAbort = new AbortController();
                const callTimeout = setTimeout(
                    () => callAbort.abort(),
                    FunctionCallingAgent.LLM_TIMEOUT_MS,
                );
                activeCallAbort = callAbort;
                this.relaxAbortSignalListenerLimit(callAbort.signal);

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
                        ).catch(() => { });
                    }
                    logger.success(`⏱ LLM応答: ${Date.now() - llmStart}ms (iteration ${iteration + 1})`);
                } catch (e: any) {
                    clearTimeout(callTimeout);
                    activeCallAbort = null;
                    if (signal?.aborted) throw new Error('Task aborted');
                    if (e.name === 'AbortError' || callAbort.signal.aborted) {
                        throw new Error(
                            `LLM timeout (${FunctionCallingAgent.LLM_TIMEOUT_MS / 1000}s)`,
                        );
                    }
                    throw e;
                }
                activeCallAbort = null;

                // ephemeral メッセージを除去（蓄積防止）
                if (ephemeralMessages.length > 0) {
                    messages.splice(messages.length - ephemeralMessages.length, ephemeralMessages.length);
                }

                messages.push(response);

                // ── 思考過程を記録（content があれば） ──
                const thinkingContent =
                    typeof response.content === 'string' ? response.content : '';
                if (thinkingContent) {
                    lastThinkingContent = thinkingContent;
                    this.thinkingTrace.push(thinkingContent);
                    logger.info(`💭 思考: ${thinkingContent.substring(0, 150)}`, 'cyan');
                    await this.maybeSummarizeThinking();
                    if (state.context?.platform === 'minecraft' || state.context?.platform === 'minebot') {
                        void this.postDetailedLogToMinebotUi(
                            goal, 'thinking', 'info', 'FunctionCallingAgent', thinkingContent,
                        );
                    }
                }

                // ── ツール呼び出しチェック ──
                const toolCalls = response.tool_calls || [];

                if (toolCalls.length === 0) {
                    consecutiveTextOnly++;

                    // UI に思考を反映
                    this.publishTaskTree({
                        status: 'in_progress',
                        goal,
                        strategy: `思考中... (${consecutiveTextOnly}/${MAX_CONSECUTIVE_TEXT_ONLY})`,
                        currentThinking: lastThinkingContent,
                        hierarchicalSubTasks: steps,
                        currentSubTaskId: steps[steps.length - 1]?.id ?? null,
                    }, state.context?.platform ?? null, state.channelId, state.taskId, state.onTaskTreeUpdate);

                    // テキストのみ応答が続きすぎたら強制終了
                    if (consecutiveTextOnly >= MAX_CONSECUTIVE_TEXT_ONLY) {
                        logger.warn(`⚠ テキストのみ応答が${MAX_CONSECUTIVE_TEXT_ONLY}回連続 → ループ終了`);
                        break;
                    }

                    // ツール呼び出しなし → 思考のみ。ループを継続して次のアクションを促す
                    const relevantRecoveryFailure = pendingRecoveryFailure ?? lastRecoverableFailure;
                    const needsMinecraftRecovery = this.requiresMinecraftRecoveryResponse(
                        state.context,
                        relevantRecoveryFailure,
                        thinkingContent,
                    );

                    if (needsMinecraftRecovery && forcedRecoveryAttempts < 2) {
                        forcedRecoveryAttempts++;
                        messages.push(
                            new SystemMessage(
                                `直前のツール失敗は recoverable (${relevantRecoveryFailure?.failureType ?? 'unknown'}) です。` +
                                '失敗報告だけで終了せず、次のいずれかを必ず行ってください: ' +
                                '1. 別手段で再試行する 2. 足りない物や条件を具体的に1つ質問する。',
                            ),
                        );
                        logger.warn(`🔁 Minecraft recovery forced after ${relevantRecoveryFailure?.toolName}`);
                        iteration++;
                        continue;
                    }

                    // 次のアクションを促すプロンプト（エスカレーション付き）
                    const nudgeMsg = consecutiveTextOnly >= 2
                        ? 'これが最後の警告です。次の応答では必ずツールを呼び出すか、task-complete を呼んでください。テキストだけの応答は無効です。'
                        : 'ツール呼び出しがありませんでした。タスクが完了したなら task-complete を呼んでください。まだ途中なら次のアクション（ツール呼び出し）を実行してください。';
                    messages.push(new SystemMessage(nudgeMsg));
                    logger.info(`🔄 テキストのみ応答 (${consecutiveTextOnly}/${MAX_CONSECUTIVE_TEXT_ONLY}) → 次のアクションを促して継続`, 'cyan');
                    iteration++;
                    continue;
                }

                // ツール呼び出しがあった → カウンタリセット
                consecutiveTextOnly = 0;

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
                            currentThinking: lastThinkingContent,
                            hierarchicalSubTasks: steps,
                            currentSubTaskId: stepId,
                        }, state.context?.platform ?? null, state.channelId, state.taskId, state.onTaskTreeUpdate);
                    }

                    if (state.onToolStarting) {
                        try { state.onToolStarting(toolCall.name, toolCall.args || {}); } catch { /* fire-and-forget */ }
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

                        if (state.context?.platform === 'minecraft' || state.context?.platform === 'minebot') {
                            void this.postDetailedLogToMinebotUi(
                                goal, 'tool_call', 'info', toolCall.name,
                                `${toolCall.name} を実行中...`,
                                { toolName: toolCall.name, parameters: toolCall.args },
                            );
                        }

                        const result = await tool.invoke(toolCall.args);
                        const duration = Date.now() - execStart;

                        const resultStr =
                            typeof result === 'string'
                                ? result
                                : JSON.stringify(result);
                        const failureMeta = this.parseToolFailureMetadata(resultStr);
                        logger.success(`  ✓ ${toolCall.name} (${duration}ms): ${resultStr.substring(0, 200)}`);

                        if (state.context?.platform === 'minecraft' || state.context?.platform === 'minebot') {
                            void this.postDetailedLogToMinebotUi(
                                goal, 'tool_result',
                                failureMeta.isError ? 'error' : 'success',
                                toolCall.name,
                                resultStr.substring(0, 300),
                                { toolName: toolCall.name, parameters: toolCall.args, duration, result: resultStr.substring(0, 200) },
                            );
                        }

                        // 結果が失敗を示しているか判定
                        const isError = failureMeta.isError;

                        // 自動ステップ記録（update-plan以外）
                        if (!isUpdatePlan && steps.length > 0) {
                            const lastStep = steps[steps.length - 1];
                            lastStep.status = isError ? 'error' : 'completed';
                            lastStep.result = FunctionCallingAgent.summarizeResultForUI(resultStr);
                            if (isError) lastStep.failureReason = FunctionCallingAgent.summarizeResultForUI(resultStr);
                        }

                        iterationResults.push({
                            toolName: toolCall.name,
                            args: toolCall.args || {},
                            success: !isError,
                            message: resultStr,
                            duration,
                            failureType: failureMeta.failureType,
                            recoverable: failureMeta.recoverable,
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
                            failureType: 'unexpected_error',
                            recoverable: false,
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

                // ── task-complete 検出 → タスク完了 ──
                const completeCall = toolCalls.find((tc: any) => tc.name === 'task-complete');
                if (completeCall) {
                    const summary = completeCall.args?.summary || 'タスク完了';
                    logger.success(`✅ FunctionCallingAgent: タスク完了 (${iteration + 1}イテレーション, ${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
                    logger.info(`   応答: ${summary.substring(0, 200)}`);

                    const awaitingUser = !!(lastRecoverableFailure && /[?？]/.test(summary));

                    this.publishTaskTree({
                        status: awaitingUser ? 'in_progress' : 'completed',
                        goal,
                        strategy: summary,
                        recoveryStatus: awaitingUser ? 'awaiting_user' : 'idle',
                        lastFailureType: (pendingRecoveryFailure ?? lastRecoverableFailure)?.failureType ?? null,
                        recoveryAttempts: forcedRecoveryAttempts,
                        hierarchicalSubTasks: steps,
                        currentSubTaskId: null,
                    }, state.context?.platform ?? null, state.channelId, state.taskId, state.onTaskTreeUpdate);

                    this.resetThinkingState();

                    return {
                        taskTree: {
                            status: awaitingUser ? 'in_progress' : 'completed',
                            goal,
                            strategy: summary,
                            recoveryStatus: awaitingUser ? 'awaiting_user' : 'idle',
                            lastFailureType: (pendingRecoveryFailure ?? lastRecoverableFailure)?.failureType ?? null,
                            recoveryAttempts: forcedRecoveryAttempts,
                            hierarchicalSubTasks: steps,
                            subTasks: null,
                        } as TaskTreeState,
                        recoveryStatus: awaitingUser ? 'awaiting_user' : 'idle',
                        recoveryAttempts: forcedRecoveryAttempts,
                        lastFailureType: (pendingRecoveryFailure ?? lastRecoverableFailure)?.failureType,
                        isEmergency,
                        messages,
                        forceStop: false,
                    };
                }

                const newRecoverableFailure = this.pickRecoverableFailure(iterationResults, state.context);
                const madeSuccessfulProgress = iterationResults.some((result) => result.success);
                if (newRecoverableFailure) {
                    pendingRecoveryFailure = newRecoverableFailure;
                    lastRecoverableFailure = newRecoverableFailure;
                } else {
                    pendingRecoveryFailure = null;
                    forcedRecoveryAttempts = 0;
                    if (madeSuccessfulProgress) {
                        lastRecoverableFailure = null;
                    }
                }

                // UI 更新（ツール実行後）
                this.publishTaskTree({
                    status: 'in_progress',
                    goal,
                    strategy: pendingRecoveryFailure
                        ? `${stepCounter}ステップ完了 / recovery ${pendingRecoveryFailure.failureType ?? 'unknown'}`
                        : `${stepCounter}ステップ完了`,
                    currentThinking: lastThinkingContent,
                    recoveryStatus: pendingRecoveryFailure ? 'retrying' : 'idle',
                    lastFailureType: (pendingRecoveryFailure ?? lastRecoverableFailure)?.failureType ?? null,
                    recoveryAttempts: forcedRecoveryAttempts,
                    hierarchicalSubTasks: steps,
                    currentSubTaskId: null,
                }, state.context?.platform ?? null, state.channelId, state.taskId, state.onTaskTreeUpdate);

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
                currentThinking: lastThinkingContent,
                recoveryStatus: (pendingRecoveryFailure ?? lastRecoverableFailure) ? 'failed_terminal' : 'idle',
                lastFailureType: (pendingRecoveryFailure ?? lastRecoverableFailure)?.failureType ?? null,
                recoveryAttempts: forcedRecoveryAttempts,
                hierarchicalSubTasks: steps,
                currentSubTaskId: null,
            }, state.context?.platform ?? null, state.channelId, state.taskId, state.onTaskTreeUpdate);

            return {
                taskTree: {
                    status: 'error',
                    goal,
                    strategy: '最大イテレーション数に到達',
                    recoveryStatus: (pendingRecoveryFailure ?? lastRecoverableFailure) ? 'failed_terminal' : 'idle',
                    lastFailureType: (pendingRecoveryFailure ?? lastRecoverableFailure)?.failureType ?? null,
                    recoveryAttempts: forcedRecoveryAttempts,
                    hierarchicalSubTasks: steps,
                    subTasks: null,
                } as TaskTreeState,
                recoveryStatus: (pendingRecoveryFailure ?? lastRecoverableFailure) ? 'failed_terminal' : 'idle',
                recoveryAttempts: forcedRecoveryAttempts,
                lastFailureType: (pendingRecoveryFailure ?? lastRecoverableFailure)?.failureType,
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
                currentThinking: lastThinkingContent,
                recoveryStatus: 'failed_terminal',
                recoveryAttempts: forcedRecoveryAttempts,
                hierarchicalSubTasks: steps,
                currentSubTaskId: null,
            }, state.context?.platform ?? null, state.channelId, state.taskId, state.onTaskTreeUpdate);

            return {
                taskTree: {
                    status: 'error',
                    goal: `エラー: ${errorMsg}`,
                    strategy: '',
                    recoveryStatus: 'failed_terminal',
                    recoveryAttempts: forcedRecoveryAttempts,
                    subTasks: null,
                } as TaskTreeState,
                recoveryStatus: 'failed_terminal',
                recoveryAttempts: forcedRecoveryAttempts,
                isEmergency,
                messages,
                forceStop: signal?.aborted || false,
            };
        } finally {
            activeCallAbort = null;
            if (signal) {
                signal.removeEventListener('abort', onParentAbort);
            }
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
        memoryPrompt?: string,
        relationshipPrompt?: string,
        selfModelPrompt?: string,
        strategyPrompt?: string,
        internalStatePrompt?: string,
        worldModelPrompt?: string,
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
            if ((context.platform === 'minebot' || context.platform === 'minecraft') && context.metadata?.minecraft) {
                const mc = context.metadata.minecraft as Record<string, unknown>;
                platformInfo += `\n- Minecraft: server=${mc.serverName || mc.serverId || ''}, world=${mc.worldId || ''}, dimension=${mc.dimension || ''}, biome=${mc.biome || ''}`;
                if (mc.position && typeof mc.position === 'object') {
                    const pos = mc.position as Record<string, unknown>;
                    platformInfo += `\n- 位置: (${pos.x ?? '?'}, ${pos.y ?? '?'}, ${pos.z ?? '?'})`;
                }
                if (typeof mc.health === 'number' || typeof mc.food === 'number') {
                    platformInfo += `\n- 状態: HP=${mc.health ?? '?'}/20, 満腹度=${mc.food ?? '?'}/20`;
                }
                if (Array.isArray(mc.inventory) && mc.inventory.length > 0) {
                    const inventorySummary = mc.inventory
                        .slice(0, 16)
                        .map((item) => {
                            if (!item || typeof item !== 'object') return null;
                            const entry = item as Record<string, unknown>;
                            return `${entry.name ?? 'unknown'}x${entry.count ?? '?'}`;
                        })
                        .filter(Boolean)
                        .join(', ');
                    if (inventorySummary) {
                        platformInfo += `\n- 所持品: ${inventorySummary}`;
                    }
                }
                if (Array.isArray(mc.nearbyEntities) && mc.nearbyEntities.length > 0) {
                    platformInfo += `\n- 近くのエンティティ: ${mc.nearbyEntities.join(', ')}`;
                }
                if (mc.eventType) {
                    platformInfo += `\n- イベント種別: ${String(mc.eventType)}`;
                }
            }
        }

        const minecraftRules =
            context?.platform === 'minecraft' || context?.platform === 'minebot'
                ? `
- **確認を求めずに即座に行動する**。「続けてもいいですか？」「よろしいですか？」は禁止。自律的に最後まで実行する
- Minecraftでは座標を推測しない。絶対座標が必要なら get-position / 周辺観測系ツールの結果を根拠に使う
- 原点付近や現在地から極端に離れた座標を思いつきで指定しない
- 今ある所持品で達成できるなら、新しく採掘・回収しに行く前にまず所持品を使う
- クラフトや精錬の前に、必要素材・必要設備がインベントリと周囲にあるかを確認する
- **採掘にツルハシが必要なのに missing_tool で失敗した場合**: 石のツルハシを作る材料(cobblestone x3以上, stick x2以上)がインベントリにあれば、**先に craft-one(stone_pickaxe) を実行する**。丸石の採掘にもツルハシが必要なため、素手で丸石を採掘しに行かないこと
- place-block-at は自分の足元または隣接マスなど、今いる位置との関係が説明できる座標だけを使う。**草(short_grass等)がある場所にはブロックを置けない**ので、先に dig-block-at で除去してから設置する
- move-to / place-block-at / mine-block が distance_too_far / path_not_found で失敗したら、同じ座標を連打せず位置確認か別手段に切り替える
- **精錬(start-smelting)のフロー**: (1) かまどの完成品スロットが空か確認(check-furnace)→空でなければ withdraw-from-furnace(slot=output)で取り出す (2) start-smeltingで精錬開始 (3) 精錬完了まで10秒程度待つ(check-furnaceで確認) (4) 完了後に withdraw-from-furnace(slot=output)で回収
- **鉄鉱石はiron_ore**(raw_ironはアイテム名)。find-blocksにはブロック名を使う
- 1ターンで依存関係のある複数ツールを同時に呼ばない（例: place-block-atとstart-smeltingを同時に呼ぶと、設置前に精錬しようとして失敗する）`
                : '';

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
        const structuredPromptSections = [
            relationshipPrompt,
            selfModelPrompt,
            strategyPrompt,
            internalStatePrompt,
            worldModelPrompt,
        ].filter(Boolean);

        if (structuredPromptSections.length > 0) {
            memoryInfo = `\n\n${structuredPromptSections.join('\n\n')}`;
            if (memoryPrompt) {
                memoryInfo += `\n\n${memoryPrompt}`;
            }
        } else if (memoryPrompt) {
            // Unified graph path: pre-formatted by ScopedMemoryService
            memoryInfo = `\n\n${memoryPrompt}`;
        } else if (memoryState) {
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

        const responseInstruction = this.buildResponseInstruction(context);

        return `あなたはAGI「シャノン」です。ユーザーの指示に従ってツールを使いタスクを実行してください。
${responseInstruction}

## 思考と行動
- **毎ターン、ツールを呼ぶ前に content（テキスト）で現状認識と次の一手の理由を1-2文で述べること**。これはあなたの思考ログとして記録される
- タスクが**完了したら task-complete ツールを呼んで宣言する**。テキストだけの応答では完了にならない
- task-complete は**最終目標が達成されたときだけ**呼ぶ。中間工程（精錬開始、移動中など）では呼ばない

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
7. 挨拶や雑談はシンプルに応答（update-plan不要、task-completeで完了宣言）
8. Twitterに投稿する際は、必ず generate-tweet-text でツイート文を生成してから post-on-twitter で投稿する。自分で直接ツイート文を書かない
${minecraftRules}

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

    private relaxAbortSignalListenerLimit(
        signal?: AbortSignal | null,
    ): void {
        if (!signal) return;
        try {
            setMaxListeners(0, signal);
        } catch {
            // Node の実装差異があっても本処理には影響させない
        }
    }

    private buildResponseInstruction(context: TaskContext | null): string {
        switch (context?.platform) {
            case 'discord':
                return '最終返信は chat-on-discord を使わず、通常の文章として返してください。システムが action plan として Discord に配信します。';
            case 'web':
                return '最終返信は chat-on-web を使わず、通常の文章として返してください。システムが action plan として Web UI に配信します。';
            case 'twitter':
                return '今は X 上の返信処理です。post-on-twitter を最終返信のために使わず、投稿本文だけを通常の文章として返してください。システムが reply/post を実行します。';
            case 'minebot':
            case 'minecraft':
                return '今は Minecraft 上で行動できます。最終返信は chat-on-web や chat-on-discord を使わず通常の文章として返してください。必要な物理行動は Minecraft 用ツールを使って実行し、システムが action plan に変換します。';
            default:
                return '最終的な回答は通常の文章として返してください。';
        }
    }

    private getDisabledOutputTools(context: TaskContext | null): string[] {
        switch (context?.platform) {
            case 'discord':
                return ['chat-on-discord'];
            case 'web':
                return ['chat-on-web'];
            case 'twitter':
                return ['post-on-twitter'];
            case 'minebot':
            case 'minecraft':
                return ['chat-on-discord', 'chat-on-web', 'post-on-twitter'];
            default:
                return [];
        }
    }

    /**
     * タスクツリーをEventBus経由でUI通知
     */
    private publishTaskTree(
        taskTree: any,
        platform: string | null,
        channelId: string | null,
        taskId: string | null,
        onTaskTreeUpdate?: (taskTree: TaskTreeState) => void,
    ): void {
        if (platform === 'minecraft' || platform === 'minebot') {
            void this.postTaskTreeToMinebotUi(taskTree);
        }
        if (onTaskTreeUpdate) {
            try {
                onTaskTreeUpdate(taskTree as TaskTreeState);
            } catch {
                // fire-and-forget
            }
        }

        // WebUI に通知
        this.eventBus.publish({
            type: 'web:planning',
            memoryZone: 'web',
            data: taskTree,
            targetMemoryZones: ['web'],
        });

        // Discord に通知（channelIdがある場合）
        if (platform === 'discord' && channelId) {
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

    private parseToolFailureMetadata(result: string): {
        isError: boolean;
        failureType?: string;
        recoverable?: boolean;
    } {
        const failureTypeMatch = result.match(/failure_type=([a-z_]+)/i);
        const recoverableMatch = result.match(/recoverable=(true|false)/i);
        const failureType = failureTypeMatch?.[1];
        const recoverable = recoverableMatch
            ? recoverableMatch[1].toLowerCase() === 'true'
            : undefined;
        const isError = Boolean(
            failureType
            || result.includes('失敗')
            || result.includes('エラー')
            || result.includes('error')
            || result.includes('見つかりません')
        );

        return {
            isError,
            failureType,
            recoverable: recoverable ?? (failureType ? failureType !== 'unexpected_error' && failureType !== 'unsafe' : undefined),
        };
    }

    private pickRecoverableFailure(
        results: ExecutionResult[],
        context: TaskContext | null,
    ): ExecutionResult | null {
        if (context?.platform !== 'minecraft' && context?.platform !== 'minebot') {
            return null;
        }

        const failed = [...results]
            .reverse()
            .find((result) => result.success === false && result.recoverable !== false);
        return failed ?? null;
    }

    private requiresMinecraftRecoveryResponse(
        context: TaskContext | null,
        failure: ExecutionResult | null,
        content: string,
    ): boolean {
        if ((context?.platform !== 'minecraft' && context?.platform !== 'minebot') || !failure) {
            return false;
        }
        return !/[?？]/.test(content);
    }

    private async postTaskTreeToMinebotUi(taskTree: TaskTreeState): Promise<void> {
        try {
            const response = await fetch(`${MINEBOT_CONFIG.UI_MOD_BASE_URL}/task`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=UTF-8' },
                body: JSON.stringify(taskTree),
            });
            if (!response.ok) {
                logger.warn(`Minebot UI task post failed: ${response.status}`);
            }
        } catch {
            // UI Mod 未接続時は黙って無視
        }
    }

    private async postDetailedLogToMinebotUi(
        goal: string,
        phase: string,
        level: string,
        source: string,
        content: string,
        metadata?: Record<string, any>,
    ): Promise<void> {
        try {
            const logEntry: Record<string, any> = {
                timestamp: new Date().toISOString(),
                phase,
                level,
                source,
                content,
            };
            if (metadata) logEntry.metadata = metadata;
            await fetch(`${MINEBOT_CONFIG.UI_MOD_BASE_URL}/task_logs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=UTF-8' },
                body: JSON.stringify({ goal, logs: [logEntry] }),
            });
        } catch {
            // UI Mod 未接続時は黙って無視
        }
    }

    // ── 思考過程管理 ──

    private resetThinkingState(): void {
        this.thinkingTrace = [];
        this.thinkingSummary = '';
    }

    private buildThinkingContext(): string | null {
        const parts: string[] = [];
        if (this.thinkingSummary) {
            parts.push(`【これまでの経緯】\n${this.thinkingSummary}`);
        }
        const recentThoughts = this.thinkingTrace.slice(-FunctionCallingAgent.THINKING_RAW_KEEP);
        if (recentThoughts.length > 0) {
            const formatted = recentThoughts
                .map((t, i) => `- [思考${this.thinkingTrace.length - recentThoughts.length + i + 1}] ${t.substring(0, 120)}`)
                .join('\n');
            parts.push(`【直近の思考】\n${formatted}`);
        }
        return parts.length > 0 ? parts.join('\n\n') : null;
    }

    private async maybeSummarizeThinking(): Promise<void> {
        const totalChars = this.thinkingTrace.reduce((sum, t) => sum + t.length, 0);
        if (totalChars < FunctionCallingAgent.THINKING_SUMMARIZE_THRESHOLD) return;
        if (this.thinkingTrace.length <= FunctionCallingAgent.THINKING_RAW_KEEP) return;

        const toSummarize = this.thinkingTrace.slice(0, -FunctionCallingAgent.THINKING_RAW_KEEP);
        const existingSummary = this.thinkingSummary ? `既存の要約: ${this.thinkingSummary}\n\n` : '';
        const rawThoughts = toSummarize.map((t, i) => `${i + 1}. ${t}`).join('\n');

        try {
            const summaryModel = createTracedModel({
                modelName: FunctionCallingAgent.MODEL_NAME,
                apiKey: config.openaiApiKey,
                temperature: 0,
                maxTokens: 300,
            });
            const result = await summaryModel.invoke([
                new SystemMessage(
                    '以下の思考過程を3-5文で簡潔に要約してください。' +
                    '何を達成し、何が未完了で、現在どの段階にいるかを含めてください。',
                ),
                new HumanMessage(`${existingSummary}新しい思考:\n${rawThoughts}`),
            ]);
            const summary = typeof result.content === 'string' ? result.content : '';
            if (summary) {
                this.thinkingSummary = summary;
                this.thinkingTrace = this.thinkingTrace.slice(-FunctionCallingAgent.THINKING_RAW_KEEP);
                logger.debug(`📝 思考要約を更新: ${summary.substring(0, 100)}`);
            }
        } catch (e) {
            logger.warn(`思考要約生成失敗: ${e instanceof Error ? e.message : 'unknown'}`);
        }
    }

    /**
     * ツール引数を表示用に要約
     */
    /**
     * UI表示用にツール実行結果を短縮
     * 座標・メタデータを除去し60文字に切り詰め
     */
    private static summarizeResultForUI(resultStr: string): string {
        let s = resultStr;
        // "結果: 成功 詳細: " / "結果: 失敗 詳細: " プレフィクスを除去
        s = s.replace(/^結果:\s*(成功|失敗)\s*詳細:\s*/, (_, status) => `${status}: `);
        // 座標パターンを除去: (-252, 37, -133) や 座標(-255, 67, -102)
        s = s.replace(/座標\s*\([^)]*\)/g, '');
        s = s.replace(/\(\s*-?\d+,\s*-?\d+,?\s*-?\d*\)/g, '');
        // "距離XXm" を除去
        s = s.replace(/距離\s*[\d.]+m/g, '');
        // [failure_type=... recoverable=...] を除去
        s = s.replace(/\[failure_type=[^\]]*\]/g, '');
        // 連続スペース・カンマを整理
        s = s.replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ').trim();
        // 末尾カンマ整理
        s = s.replace(/,\s*$/, '');
        if (s.length > 60) s = s.substring(0, 57) + '...';
        return s;
    }

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

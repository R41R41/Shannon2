import {
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    HumanMessage,
    SystemMessage,
} from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { HierarchicalSubTask, TaskContext, TaskTreeState } from '@shannon/common';
import { setMaxListeners } from 'node:events';
import { config } from '../../../../config/env.js';
import { modelManager } from '../../../../config/modelManager.js';
import { logger } from '../../../../utils/logger.js';
import { getEventBus } from '../../../eventBus/index.js';
import { WorldKnowledgeService } from '../../../minebot/knowledge/WorldKnowledgeService.js';
import UpdatePlanTool from '../../tools/utility/updatePlan.js';
import { trimContext } from '../../utils/contextManager.js';
import { createTracedModel } from '../../utils/langfuse.js';
import { tokenTracker } from '../../utils/tokenTracker.js';
import { ExecutionResult } from '../types.js';
import { EmotionState } from './EmotionNode.js';
import { MemoryState } from './MemoryNode.js';
import { PromptBuilder } from './prompt/PromptBuilder.js';
import { TaskTreePublisher } from './execution/TaskTreePublisher.js';
import { ThinkingManager } from './execution/ThinkingManager.js';
import { ToolExecutor } from './execution/ToolExecutor.js';

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
    private modelWithTools: ReturnType<ChatOpenAI['bindTools']>;
    private tools: StructuredTool[];
    private toolMap: Map<string, StructuredTool>;
    private updatePlanTool: UpdatePlanTool | null = null;

    // Sub-components
    private promptBuilder: PromptBuilder;
    private taskTreePublisher: TaskTreePublisher;
    private thinkingManager: ThinkingManager;
    private toolExecutor: ToolExecutor;

    // ユーザーからのリアルタイムフィードバック
    private pendingFeedback: string[] = [];

    // === 設定 ===
    static get MODEL_NAME() { return modelManager.get('functionCalling'); }
    static readonly MAX_ITERATIONS = 50;
    static readonly LLM_TIMEOUT_MS = 30000;   // 1回のLLM呼び出し: 30秒
    static readonly MAX_TOTAL_TIME_MS = 300000; // 全体: 5分

    constructor(tools: StructuredTool[]) {
        const eventBus = getEventBus();
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

        // Sub-components
        this.promptBuilder = new PromptBuilder();
        this.taskTreePublisher = new TaskTreePublisher(eventBus);
        this.thinkingManager = new ThinkingManager();
        this.toolExecutor = new ToolExecutor(this.taskTreePublisher);

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

        this.thinkingManager.resetThinkingState();
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

        const channelOutputTools = this.promptBuilder.getDisabledOutputTools(state.context);
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
        let systemPrompt = this.promptBuilder.buildSystemPrompt(
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
        if (state.messages && state.messages.length > 0) {
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
        this.taskTreePublisher.publishTaskTree({
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
                if (iteration > 0 && this.thinkingManager.hasThoughts()) {
                    const thinkingContext = this.thinkingManager.buildThinkingContext();
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
                        response = await this.streamLlmResponse(
                            effectiveModelWithTools, messages, callAbort.signal, state.onStreamSentence,
                        );
                    } else {
                        response = (await effectiveModelWithTools.invoke(messages, {
                            signal: callAbort.signal,
                        })) as AIMessage;
                    }
                    clearTimeout(callTimeout);
                    const usage = (response as AIMessage & { usage_metadata?: { input_tokens?: number; output_tokens?: number } })?.usage_metadata;
                    if (usage) {
                        tokenTracker.record(
                            this.model.modelName || 'unknown',
                            'FunctionCallingAgent',
                            usage.input_tokens || 0,
                            usage.output_tokens || 0,
                        ).catch(() => { });
                    }
                    logger.success(`⏱ LLM応答: ${Date.now() - llmStart}ms (iteration ${iteration + 1})`);
                } catch (e: unknown) {
                    clearTimeout(callTimeout);
                    activeCallAbort = null;
                    if (signal?.aborted) throw new Error('Task aborted');
                    if ((e instanceof Error && e.name === 'AbortError') || callAbort.signal.aborted) {
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
                    this.thinkingManager.addThought(thinkingContent);
                    logger.info(`💭 思考: ${thinkingContent.substring(0, 150)}`, 'cyan');
                    await this.thinkingManager.maybeSummarizeThinking(FunctionCallingAgent.MODEL_NAME);
                    if (state.context?.platform === 'minecraft' || state.context?.platform === 'minebot') {
                        void this.taskTreePublisher.postDetailedLogToMinebotUi(
                            goal, 'thinking', 'info', 'FunctionCallingAgent', thinkingContent,
                        );
                    }
                }

                // ── ツール呼び出しチェック ──
                const toolCalls = response.tool_calls || [];

                if (toolCalls.length === 0) {
                    consecutiveTextOnly++;

                    // UI に思考を反映
                    this.taskTreePublisher.publishTaskTree({
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
                    const needsMinecraftRecovery = ToolExecutor.requiresMinecraftRecoveryResponse(
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

                const execResult = await this.toolExecutor.executeToolCalls(
                    toolCalls,
                    effectiveToolMap,
                    messages,
                    {
                        goal,
                        platform: state.context?.platform ?? null,
                        channelId: state.channelId,
                        taskId: state.taskId,
                        context: state.context,
                        steps,
                        stepCounter,
                        lastThinkingContent,
                        onToolStarting: state.onToolStarting,
                        onTaskTreeUpdate: state.onTaskTreeUpdate,
                    },
                    signal,
                );
                stepCounter = execResult.stepCounter;
                const iterationResults = execResult.results;

                // ── task-complete 検出 → タスク完了 ──
                const completeCall = toolCalls.find((tc) => tc.name === 'task-complete');
                if (completeCall) {
                    const summary = completeCall.args?.summary || 'タスク完了';
                    logger.success(`✅ FunctionCallingAgent: タスク完了 (${iteration + 1}イテレーション, ${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
                    logger.info(`   応答: ${summary.substring(0, 200)}`);

                    const awaitingUser = !!(lastRecoverableFailure && /[?？]/.test(summary));

                    this.taskTreePublisher.publishTaskTree({
                        status: awaitingUser ? 'in_progress' : 'completed',
                        goal,
                        strategy: summary,
                        recoveryStatus: awaitingUser ? 'awaiting_user' : 'idle',
                        lastFailureType: (pendingRecoveryFailure ?? lastRecoverableFailure)?.failureType ?? null,
                        recoveryAttempts: forcedRecoveryAttempts,
                        hierarchicalSubTasks: steps,
                        currentSubTaskId: null,
                    }, state.context?.platform ?? null, state.channelId, state.taskId, state.onTaskTreeUpdate);

                    this.thinkingManager.resetThinkingState();

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

                const newRecoverableFailure = ToolExecutor.pickRecoverableFailure(iterationResults, state.context);
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
                this.taskTreePublisher.publishTaskTree({
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

            this.taskTreePublisher.publishTaskTree({
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

            this.taskTreePublisher.publishTaskTree({
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

    // ── Private helpers ──

    /**
     * ストリーミングモードでLLM応答を取得し、文境界でコールバックを呼ぶ
     */
    private async streamLlmResponse(
        modelWithTools: ReturnType<ChatOpenAI['bindTools']>,
        messages: BaseMessage[],
        signal: AbortSignal,
        onStreamSentence: (sentence: string) => Promise<void>,
    ): Promise<AIMessage> {
        const stream = await modelWithTools.stream(messages, { signal });

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
                            await onStreamSentence(sentence);
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
                await onStreamSentence(sentenceBuffer.trim());
            } catch (err) {
                logger.error('onStreamSentence (tail) error:', err);
            }
        }

        // AIMessageChunk -> AIMessage に変換
        if (accumulatedChunk) {
            return new AIMessage({
                content: accumulatedChunk.content,
                tool_calls: accumulatedChunk.tool_calls,
                additional_kwargs: accumulatedChunk.additional_kwargs,
            });
        }
        return new AIMessage({ content: '' });
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
}

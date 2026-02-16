import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';
import {
  EmotionType,
  MemoryZone,
  TaskContext,
  TaskTreeState,
  memoryZoneToContext,
} from '@shannon/common';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadToolsFromDirectory } from '../../../utils/toolLoader.js';
import { EventBus } from '../../eventBus/eventBus.js';
import { getEventBus } from '../../eventBus/index.js';
import { EmotionNode, EmotionState } from './nodes/EmotionNode.js';
import { FunctionCallingAgent } from './nodes/FunctionCallingAgent.js';
import { MemoryNode, MemoryState } from './nodes/MemoryNode.js';
import { createMemoryTools } from '../tools/memory/memoryToolFactory.js';
import { IExchange } from '../../../models/PersonMemory.js';
import {
  ExecutionResult,
  GRAPH_CONFIG,
  TaskListState,
  TaskQueueEntry,
  TaskStateInput,
} from './types.js';
import { logger } from '../../../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * TaskGraph: EmotionNode(擬似並列) + FunctionCallingAgent 構成
 * 
 * フロー:
 * 1. EmotionNode で初回感情分析 (同期)
 * 2. FunctionCallingAgent でタスク実行 (反復ループ)
 * 3. ツール実行後、EmotionNode で非同期感情再評価 (fire-and-forget)
 * 4. FunctionCallingAgent は各イテレーションで最新の感情を読み込み
 * 
 * 特徴:
 * - 感情と行動の擬似並列: 双方向に影響を与え合う
 * - update-plan ツールでLLMが自発的に計画 + 自動ステップ記録 (hybrid)
 * - タスクキュー（最大3つ + 緊急1つ）
 * - EventBus経由のUI通知
 */
export class TaskGraph {
  private static instance: TaskGraph;
  private tools: StructuredTool[] = [];
  private emotionNode: EmotionNode | null = null;
  private memoryNode: MemoryNode | null = null;
  private functionCallingAgent: FunctionCallingAgent | null = null;
  private eventBus: EventBus;
  public currentState: any = null;

  // タスクキュー
  private taskQueue: TaskQueueEntry[] = [];
  private emergencyTask: TaskQueueEntry | null = null;
  private isEmergencyMode = false;
  private isExecuting = false;
  private abortController: AbortController | null = null;

  // タスクリスト更新コールバック
  private onTaskListUpdate: ((tasks: TaskListState) => void) | null = null;

  constructor() {
    this.eventBus = getEventBus();
    this.initializeEventBus();
  }

  public static getInstance(): TaskGraph {
    if (!TaskGraph.instance) {
      TaskGraph.instance = new TaskGraph();
    }
    return TaskGraph.instance;
  }

  /**
   * 初期化
   */
  public async initialize() {
    await this.initializeTools();

    // EmotionNode 初期化（Prompt依存を除去）
    this.emotionNode = new EmotionNode();

    // MemoryNode 初期化
    this.memoryNode = new MemoryNode();
    await this.memoryNode.initialize();

    // 記憶ツールを追加（サービスインスタンスを注入）
    const memoryTools = createMemoryTools();
    this.tools.push(...memoryTools);

    // FunctionCallingAgent 初期化（ツール群を渡す）
    this.functionCallingAgent = new FunctionCallingAgent(this.tools);

    logger.info('✅ TaskGraph initialized (FunctionCalling + Memory mode)', 'cyan');
  }

  /**
   * EventBusのイベントを設定
   */
  private initializeEventBus() {
    this.eventBus.subscribe('task:stop', (event) => {
      logger.info('タスクを停止します');
      this.forceStop();
    });

    this.eventBus.subscribe('task:start', () => {
      logger.info('タスクを再開します');
      this.executeNextTask();
    });
  }

  /**
   * ツールを初期化
   */
  private async initializeTools() {
    const toolsDir = join(__dirname, '../tools');
    this.tools = await loadToolsFromDirectory(toolsDir, 'LLM');
  }

  /**
   * タスクを実行
   * 
   * 新フロー:
   * 1. EmotionNode で初回感情分析 (同期)
   * 2. MemoryNode.preProcess で記憶取得 (同期)
   * 3. FunctionCallingAgent.run() でタスク実行
   *    - 各イテレーションで emotionState.current を読み込み
   *    - ツール実行後に onToolsExecuted で非同期感情再評価をトリガー
   * 4. MemoryNode.postProcess で記憶保存 + 人物更新 (非同期)
   */
  public async invoke(partialState: TaskStateInput) {
    // 排他制御
    if (this.isExecuting) {
      logger.warn(`⚠️ タスク実行中のため、新しいタスクをスキップします (message: ${partialState.userMessage?.substring(0, 50)})`);
      return null;
    }

    this.isExecuting = true;
    this.abortController = new AbortController();

    // コンテキストの正規化
    let context = partialState.context || null;
    if (!context && partialState.memoryZone) {
      context = memoryZoneToContext(partialState.memoryZone, partialState.channelId || undefined);
    }

    const taskId = crypto.randomUUID();

    // 共有感情状態
    const emotionState: EmotionState = {
      current: partialState.emotion || null,
    };

    // 簡易 state（FunctionCallingAgent に渡すため）
    const state = {
      taskId,
      context,
      channelId: partialState.channelId ?? null,
      environmentState: partialState.environmentState ?? null,
      messages: partialState.messages ?? [],
      userMessage: partialState.userMessage ?? null,
      isEmergency: partialState.isEmergency ?? false,
    };

    this.currentState = {
      ...state,
      forceStop: false,
      taskTree: {
        status: 'in_progress',
        goal: '',
        strategy: '',
        subTasks: null,
      },
    };

    try {
      logger.info(`🚀 タスク実行開始 ID: ${taskId}`);

      // === Step 1: EmotionNode 初回評価 (同期) ===
      if (this.emotionNode) {
        try {
          const emotionResult = await this.emotionNode.invoke({
            userMessage: state.userMessage,
            messages: state.messages,
            environmentState: state.environmentState,
            emotion: emotionState.current,
          });
          emotionState.current = emotionResult.emotion;
          logger.info(`💭 初回感情: ${emotionState.current?.emotion}`);
        } catch (error) {
          logger.error('❌ 初回感情分析エラー:', error);
          // エラーでも続行（感情なしでFunctionCallingAgentを実行）
        }
      }

      // === Step 2: MemoryNode.preProcess (同期) ===
      let memoryState: MemoryState = { person: null, experiences: [], knowledge: [] };
      if (this.memoryNode) {
        try {
          memoryState = await this.memoryNode.preProcess({
            userMessage: state.userMessage,
            context,
          });
        } catch (error) {
          logger.error('❌ MemoryNode preProcess エラー:', error);
          // エラーでも続行（記憶なしでFCAを実行）
        }
      }

      // === Step 3: FunctionCallingAgent 実行 ===
      if (!this.functionCallingAgent) {
        throw new Error('FunctionCallingAgent not initialized');
      }

      const agentResult = await this.functionCallingAgent.run(
        {
          taskId,
          userMessage: state.userMessage,
          messages: state.messages,
          emotionState,
          memoryState,
          context,
          channelId: state.channelId,
          environmentState: state.environmentState,
          isEmergency: state.isEmergency,

          // ツール実行後のコールバック: 非同期感情再評価
          onToolsExecuted: (messages: BaseMessage[], results: ExecutionResult[]) => {
            if (this.emotionNode) {
              this.emotionNode
                .evaluateAsync(messages, results, emotionState.current)
                .then((newEmotion) => {
                  emotionState.current = newEmotion;
                  logger.info(`💭 感情更新(非同期): ${newEmotion.emotion}`);
                })
                .catch((err) => {
                  logger.error('❌ 非同期感情再評価エラー:', err);
                });
            }
          },
        },
        this.abortController?.signal,
      );

      // 結果を整形
      const result = {
        taskId,
        taskTree: agentResult.taskTree,
        messages: agentResult.messages || [],
        forceStop: agentResult.forceStop,
        isEmergency: agentResult.isEmergency,
        emotion: emotionState.current,
      };

      if (result.taskTree?.status === 'in_progress') {
        result.taskTree.status = 'error';
      }

      logger.info(`✅ タスク完了: ${JSON.stringify({ taskId: result.taskId, status: result.taskTree?.status, messageCount: result.messages.length, finalEmotion: emotionState.current?.emotion })}`);

      // === Fallback: FCA がチャットツールを呼ばずにテキスト応答で終了した場合 ===
      if (
        context?.platform === 'discord' &&
        state.channelId &&
        result.taskTree?.strategy &&
        result.taskTree.strategy !== 'タスク完了'
      ) {
        // chat-on-discord が呼ばれたか確認
        const chatToolCalled = (agentResult.messages || []).some(
          (m: BaseMessage) => {
            if (m instanceof AIMessage && m.tool_calls) {
              return m.tool_calls.some(
                (tc: any) => tc.name === 'chat-on-discord'
              );
            }
            return false;
          }
        );
        if (!chatToolCalled) {
          logger.warn('⚠️ FCA が chat-on-discord を呼ばなかったため、フォールバック送信');
          this.eventBus.publish({
            type: 'discord:post_message',
            memoryZone: partialState.memoryZone || 'web',
            data: {
              text: result.taskTree.strategy,
              channelId: state.channelId,
              guildId: context.discord?.guildId || '',
            },
          });
        }
      }

      // === Step 4: MemoryNode.postProcess (非同期 fire-and-forget) ===
      if (this.memoryNode && state.userMessage) {
        const exchanges: IExchange[] = [];
        // ユーザーメッセージ
        exchanges.push({
          role: 'user',
          content: state.userMessage,
          timestamp: new Date(),
        });
        // シャノンの応答を抽出
        const assistantMessages = agentResult.messages
          ?.filter((m: BaseMessage) => m instanceof AIMessage)
          ?.map((m: BaseMessage) => typeof m.content === 'string' ? m.content : '')
          ?.filter((c: string) => c.length > 0) ?? [];
        for (const msg of assistantMessages) {
          exchanges.push({
            role: 'assistant',
            content: msg.substring(0, 500),
            timestamp: new Date(),
          });
        }

        const conversationText = exchanges
          .map((e) => `${e.role}: ${e.content}`)
          .join('\n');

        this.memoryNode.postProcess({
          context,
          conversationText,
          exchanges,
        }).catch((err) => {
          logger.error('❌ MemoryNode postProcess エラー:', err);
        });
      }

      this.currentState = result;
      return result;
    } catch (error) {
      // AbortError
      if (
        error instanceof Error &&
        (error.name === 'AbortError' ||
          error.message?.includes('aborted') ||
          error.message?.includes('abort'))
      ) {
        logger.warn('⚠️ タスクが強制停止されました');
        return {
          taskId,
          forceStop: true,
          taskTree: {
            status: 'error',
            goal: '強制停止',
            strategy: '',
            subTasks: null,
          },
        };
      }

      logger.error('タスク実行エラー:', error);
      return {
        taskId,
        taskTree: {
          status: 'error',
          goal: `エラー: ${error instanceof Error ? error.message : '不明なエラー'}`,
          strategy: '',
          subTasks: null,
        },
      };
    } finally {
      this.isExecuting = false;
      this.abortController = null;

      if (partialState.isEmergency || this.isEmergencyMode) {
        logger.warn('🚨 緊急タスク終了');
        this.isEmergencyMode = false;
        this.emergencyTask = null;
      }

      // キューに待機中のタスクがあれば次を実行
      const hasPendingTasks = this.taskQueue.some(
        (t) => t.status === 'pending' || t.status === 'paused'
      );
      if (hasPendingTasks && !this.isEmergencyMode) {
        setTimeout(() => this.executeNextTask(), 500);
      }
    }
  }

  /**
   * タスクを強制終了
   */
  public forceStop() {
    if (this.currentState) {
      this.currentState.forceStop = true;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * humanFeedbackを更新
   */
  public updateHumanFeedback(feedback: string) {
    // FunctionCallingAgent に直接フィードバック
    if (this.functionCallingAgent) {
      this.functionCallingAgent.addFeedback(feedback);
    }

    if (this.currentState) {
      this.currentState.humanFeedback = feedback;
      this.currentState.humanFeedbackPending = true;
    }
  }

  /**
   * タスクが実行中かどうか
   */
  public isRunning(): boolean {
    return this.isExecuting;
  }

  // ========== タスクキュー管理 ==========

  /**
   * タスクをキューに追加
   */
  public addTaskToQueue(
    taskInput: TaskStateInput
  ): { success: boolean; reason?: string; taskId?: string } {
    if (this.taskQueue.length >= GRAPH_CONFIG.MAX_QUEUE_SIZE) {
      return {
        success: false,
        reason: 'タスクキューがいっぱいです。',
      };
    }

    const taskId = crypto.randomUUID();
    const task: TaskQueueEntry = {
      id: taskId,
      taskTree: taskInput.taskTree ||
        ({ goal: taskInput.userMessage || 'New Task', status: 'pending' } as any),
      state: taskInput,
      createdAt: Date.now(),
      status: 'pending',
    };

    this.taskQueue.push(task);
    logger.success(`📥 タスクをキューに追加: "${task.taskTree?.goal}" (${this.taskQueue.length}/${GRAPH_CONFIG.MAX_QUEUE_SIZE})`);

    this.notifyTaskListUpdate();

    if (
      this.taskQueue.length === 1 &&
      !this.isExecuting &&
      !this.isEmergencyMode
    ) {
      this.executeNextTask();
    }

    return { success: true, taskId };
  }

  /**
   * タスクを削除
   */
  public removeTask(taskId: string): { success: boolean; reason?: string } {
    const taskIndex = this.taskQueue.findIndex((t) => t.id === taskId);
    if (taskIndex === -1) {
      return { success: false, reason: 'タスクが見つかりません' };
    }

    const task = this.taskQueue[taskIndex];
    const wasExecuting = task.status === 'executing';

    this.taskQueue.splice(taskIndex, 1);

    if (wasExecuting && this.isExecuting) {
      this.forceStop();
    }

    this.notifyTaskListUpdate();

    if (wasExecuting && !this.isEmergencyMode) {
      this.executeNextTask();
    }

    return { success: true };
  }

  /**
   * 次のタスクを実行
   */
  private async executeNextTask(): Promise<void> {
    if (this.isExecuting || this.isEmergencyMode) {
      return;
    }

    const nextTask = this.taskQueue.find(
      (t) => t.status === 'pending' || t.status === 'paused'
    );
    if (!nextTask) {
      logger.warn('📭 実行するタスクがありません');
      return;
    }

    nextTask.status = 'executing';
    this.notifyTaskListUpdate();

    logger.success(`▶️ タスク実行開始: "${nextTask.taskTree?.goal}"`);

    await this.invoke(nextTask.state);
    this.handleTaskCompletion(nextTask.id);
  }

  /**
   * タスク完了時の処理
   */
  private handleTaskCompletion(taskId: string): void {
    const taskIndex = this.taskQueue.findIndex((t) => t.id === taskId);
    if (taskIndex !== -1) {
      const task = this.taskQueue[taskIndex];
      const taskStatus = this.currentState?.taskTree?.status;

      if (taskStatus === 'error') {
        task.status = 'paused';
        task.taskTree = this.currentState?.taskTree || task.taskTree;
      } else {
        this.taskQueue.splice(taskIndex, 1);
      }
    }

    this.notifyTaskListUpdate();

    const taskStatus = this.currentState?.taskTree?.status;
    if (!this.isEmergencyMode && taskStatus !== 'error') {
      setTimeout(() => this.executeNextTask(), 500);
    }
  }

  /**
   * タスクリストの状態を取得
   */
  public getTaskListState(): TaskListState {
    return {
      tasks: this.taskQueue.map((t) => ({
        id: t.id,
        goal: t.taskTree?.goal || 'Unknown',
        status: t.status,
        createdAt: t.createdAt,
      })),
      emergencyTask: this.emergencyTask
        ? {
            id: this.emergencyTask.id,
            goal: this.emergencyTask.taskTree?.goal || 'Emergency',
            createdAt: this.emergencyTask.createdAt,
          }
        : null,
      currentTaskId: this.isExecuting
        ? this.taskQueue.find((t) => t.status === 'executing')?.id || null
        : null,
    };
  }

  /**
   * タスクリスト更新コールバックを設定
   */
  public setTaskListUpdateCallback(
    callback: (tasks: TaskListState) => void
  ): void {
    this.onTaskListUpdate = callback;
  }

  /**
   * タスクリスト更新を通知
   */
  private notifyTaskListUpdate(): void {
    if (this.onTaskListUpdate) {
      this.onTaskListUpdate(this.getTaskListState());
    }
  }
}

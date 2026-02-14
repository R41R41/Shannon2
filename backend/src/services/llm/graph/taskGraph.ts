import { BaseMessage } from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';
import {
  EmotionType,
  MemoryZone,
  TaskContext,
  TaskTreeState,
  memoryZoneToContext,
} from '@shannon/common';
import dotenv from 'dotenv';
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { EventBus } from '../../eventBus/eventBus.js';
import { getEventBus } from '../../eventBus/index.js';
import { EmotionNode, EmotionState } from './nodes/EmotionNode.js';
import { FunctionCallingAgent } from './nodes/FunctionCallingAgent.js';
import {
  ExecutionResult,
  GRAPH_CONFIG,
  TaskListState,
  TaskQueueEntry,
  TaskStateInput,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

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

    // FunctionCallingAgent 初期化（ツール群を渡す）
    this.functionCallingAgent = new FunctionCallingAgent(this.tools);

    console.log('\x1b[36m✅ TaskGraph initialized (FunctionCalling mode)\x1b[0m');
  }

  /**
   * EventBusのイベントを設定
   */
  private initializeEventBus() {
    this.eventBus.subscribe('task:stop', (event) => {
      console.log('タスクを停止します');
      this.forceStop();
    });

    this.eventBus.subscribe('task:start', () => {
      console.log('タスクを再開します');
      this.executeNextTask();
    });
  }

  /**
   * ツールを初期化
   */
  private async initializeTools() {
    const toolsDir = join(__dirname, '../tools');
    const toolFiles = readdirSync(toolsDir).filter(
      (file) =>
        (file.endsWith('.ts') || file.endsWith('.js')) &&
        !file.includes('.d.ts')
    );

    this.tools = [];

    for (const file of toolFiles) {
      if (file === 'index.ts' || file === 'index.js') continue;

      try {
        const toolModule = await import(join(toolsDir, file));
        const ToolClass = toolModule.default;
        if (ToolClass?.prototype?.constructor) {
          this.tools.push(new ToolClass());
        }
      } catch (error) {
        console.error(`ツール読み込みエラー: ${file}`, error);
      }
    }
    console.log(`✅ ${this.tools.length} tools loaded`);
  }

  /**
   * タスクを実行
   * 
   * 新フロー:
   * 1. EmotionNode で初回感情分析 (同期)
   * 2. FunctionCallingAgent.run() でタスク実行
   *    - 各イテレーションで emotionState.current を読み込み
   *    - ツール実行後に onToolsExecuted で非同期感情再評価をトリガー
   */
  public async invoke(partialState: TaskStateInput) {
    // 排他制御
    if (this.isExecuting) {
      console.log('\x1b[33m⚠️ タスク実行中のため、新しいタスクをスキップします\x1b[0m');
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
      console.log('🚀 タスク実行開始 ID:', taskId);

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
          console.log(`💭 初回感情: ${emotionState.current?.emotion}`);
        } catch (error) {
          console.error('❌ 初回感情分析エラー:', error);
          // エラーでも続行（感情なしでFunctionCallingAgentを実行）
        }
      }

      // === Step 2: FunctionCallingAgent 実行 ===
      if (!this.functionCallingAgent) {
        throw new Error('FunctionCallingAgent not initialized');
      }

      const agentResult = await this.functionCallingAgent.run(
        {
          taskId,
          userMessage: state.userMessage,
          messages: state.messages,
          emotionState,
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
                  console.log(`💭 感情更新(非同期): ${newEmotion.emotion}`);
                })
                .catch((err) => {
                  console.error('❌ 非同期感情再評価エラー:', err);
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

      console.log('✅ タスク完了:', {
        taskId: result.taskId,
        status: result.taskTree?.status,
        messageCount: result.messages.length,
        finalEmotion: emotionState.current?.emotion,
      });

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
        console.log('\x1b[33m⚠️ タスクが強制停止されました\x1b[0m');
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

      console.error('タスク実行エラー:', error);
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
        console.log('\x1b[33m🚨 緊急タスク終了\x1b[0m');
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
    console.log(
      `\x1b[32m📥 タスクをキューに追加: "${task.taskTree?.goal}" (${this.taskQueue.length}/${GRAPH_CONFIG.MAX_QUEUE_SIZE})\x1b[0m`
    );

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
      console.log('\x1b[33m📭 実行するタスクがありません\x1b[0m');
      return;
    }

    nextTask.status = 'executing';
    this.notifyTaskListUpdate();

    console.log(
      `\x1b[32m▶️ タスク実行開始: "${nextTask.taskTree?.goal}"\x1b[0m`
    );

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

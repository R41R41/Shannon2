import { BaseMessage } from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
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
import { EmotionNode, ExecutionNode, PlanningNode } from './nodes/index.js';
import { Prompt } from './prompt.js';
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
 * TaskGraph: 3ノード構成のタスク実行グラフ
 * 
 * フロー: emotion → planning → execution → planning → ...
 * 
 * 特徴:
 * - 階層的サブタスク対応
 * - タスクキュー（最大3つ + 緊急1つ）
 * - 再試行・デッドループ検出
 * - EventBus経由のログ
 */
export class TaskGraph {
  private static instance: TaskGraph;
  private tools: StructuredTool[] = [];
  private emotionNode: EmotionNode | null = null;
  private planningNode: PlanningNode | null = null;
  private executionNode: ExecutionNode | null = null;
  private graph: any;
  private eventBus: EventBus;
  private prompt: Prompt | null = null;
  public currentState: any = null;

  // タスクキュー
  private taskQueue: TaskQueueEntry[] = [];
  private emergencyTask: TaskQueueEntry | null = null;
  private isEmergencyMode = false;
  private isExecuting = false;

  // 直近の成功アクション履歴（デッドループ検出用）
  private recentSuccessfulActions: string[] = [];

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
    this.prompt = new Prompt(this.tools);

    // ノードを初期化
    this.emotionNode = new EmotionNode(this.prompt);
    this.planningNode = new PlanningNode(this.prompt);
    this.executionNode = new ExecutionNode(this.tools);

    this.graph = this.createGraph();
    console.log('\x1b[36m✅ TaskGraph initialized\x1b[0m');
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
   * State定義
   */
  private TaskState = Annotation.Root({
    taskId: Annotation<string>({
      reducer: (_, next) => next,
      default: () => '',
    }),
    // コンテキスト情報
    context: Annotation<TaskContext | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
    /** @deprecated contextを使用してください */
    memoryZone: Annotation<MemoryZone>({
      reducer: (_, next) => next,
      default: () => 'web',
    }),
    channelId: Annotation<string | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
    // 環境・状態
    environmentState: Annotation<string | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
    selfState: Annotation<string | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
    // フィードバック
    humanFeedback: Annotation<string | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
    selfFeedback: Annotation<string | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
    // メッセージ
    messages: Annotation<BaseMessage[]>({
      reducer: (prev, next) => {
        if (next === null) {
          return prev;
        } else {
          return prev?.concat(next) ?? next;
        }
      },
      default: () => [],
    }),
    userMessage: Annotation<string | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
    // 感情
    emotion: Annotation<EmotionType | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
    // タスク
    taskTree: Annotation<TaskTreeState | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
    // 制御
    humanFeedbackPending: Annotation<boolean>({
      reducer: (_, next) => next,
      default: () => false,
    }),
    retryCount: Annotation<number>({
      reducer: (prev, next) => (next === undefined ? prev : next),
      default: () => 0,
    }),
    forceStop: Annotation<boolean>({
      reducer: (_, next) => next,
      default: () => false,
    }),
    // 実行結果
    executionResults: Annotation<ExecutionResult[] | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
    // 緊急フラグ
    isEmergency: Annotation<boolean>({
      reducer: (_, next) => next,
      default: () => false,
    }),
  });

  /**
   * グラフを作成
   */
  private createGraph() {
    if (!this.emotionNode || !this.planningNode || !this.executionNode) {
      throw new Error('Nodes not initialized');
    }

    const workflow = new StateGraph(this.TaskState)
      // Emotion Node
      .addNode('feel_emotion', async (state) => {
        return await this.emotionNode!.invoke(state);
      })
      // Planning Node
      .addNode('planning', async (state) => {
        // humanFeedbackとretryCountを現在の状態から取得
        state.humanFeedback =
          this.currentState?.humanFeedback || state.humanFeedback;
        state.retryCount = this.currentState?.retryCount || state.retryCount || 0;

        // 前回の実行結果を引き継ぎ
        if (this.currentState?.executionResults) {
          state.executionResults = this.currentState.executionResults;
        }

        return await this.planningNode!.invoke(state);
      })
      // Execution Node
      .addNode('execution', async (state) => {
        const result = await this.executionNode!.invoke(state);

        // 実行結果を処理
        const hasError = result.hasError || false;
        let newRetryCount = state.retryCount || 0;

        if (hasError) {
          newRetryCount = newRetryCount + 1;
          this.currentState.retryCount = newRetryCount;
          console.log(`\x1b[33m⚠ エラー発生（再試行回数: ${newRetryCount}/${GRAPH_CONFIG.MAX_RETRY_COUNT}）\x1b[0m`);
        } else {
          newRetryCount = 0;
          this.currentState.retryCount = 0;
        }

        // 実行結果をcurrentStateに保存
        this.currentState.executionResults = result.executionResults;

        return {
          ...result,
          retryCount: newRetryCount,
          executionResults: result.executionResults,
        };
      })
      // エッジ
      .addEdge(START, 'feel_emotion')
      .addEdge('feel_emotion', 'planning')
      .addConditionalEdges('planning', (state) => {
        if (this.currentState?.forceStop) {
          return END;
        }

        // status: completed/error の場合は終了
        if (state.taskTree?.status === 'completed') {
          console.log('\x1b[32m✅ タスク完了\x1b[0m');
          return END;
        }
        if (state.taskTree?.status === 'error') {
          console.log('\x1b[31m❌ タスクエラー\x1b[0m');
          return END;
        }

        // nextActionSequenceがあるかチェック
        const hasActions =
          (state.taskTree?.nextActionSequence && state.taskTree.nextActionSequence.length > 0) ||
          (state.taskTree?.actionSequence && state.taskTree.actionSequence.length > 0);

        if (hasActions) {
          return 'execution';
        }

        console.log('\x1b[33m⚠ アクションなし、終了\x1b[0m');
        return END;
      })
      .addConditionalEdges('execution', (state) => {
        if (this.currentState?.forceStop) {
          return END;
        }

        // 再試行回数チェック
        const retryCount = state.retryCount || 0;
        if (retryCount >= GRAPH_CONFIG.MAX_RETRY_COUNT) {
          console.log(
            `\x1b[31m✗ 最大再試行回数（${GRAPH_CONFIG.MAX_RETRY_COUNT}回）に達しました。\x1b[0m`
          );
          return END;
        }

        // デッドループ検出
        const execResults = state.executionResults || [];
        const successfulActions = execResults
          .filter((r: any) => r.success)
          .map((r: any) => {
            const args = r.args || {};
            if (r.toolName === 'chat-on-web' || r.toolName === 'chat-on-discord') {
              // チャットはメッセージの先頭50文字で区別
              const msgKey = (args.message || '').substring(0, 50);
              return `${r.toolName}@${msgKey}`;
            } else if (r.toolName === 'describe-image') {
              // 画像分析はURLで区別（異なるURLなら別アクション）
              const urlKey = (args.image_url || '').substring(0, 80);
              return `${r.toolName}@${urlKey}`;
            } else if (r.toolName === 'describe-notion-image') {
              // Notion画像は番号で区別
              return `${r.toolName}@${args.image_number || 0}`;
            } else if (r.toolName === 'fetch-url' || r.toolName === 'google-search') {
              // 検索系もURLやクエリで区別
              const key = (args.url || args.query || '').substring(0, 50);
              return `${r.toolName}@${key}`;
            }
            return r.toolName;
          });

        if (successfulActions.length > 0) {
          this.recentSuccessfulActions = [
            ...this.recentSuccessfulActions,
            ...successfulActions
          ].slice(-15);
        }

        // 同じアクションの繰り返し検出
        const actionHistory = this.recentSuccessfulActions;
        if (actionHistory.length >= 2) {
          const lastAction = actionHistory[actionHistory.length - 1];
          const toolName = lastAction.split('@')[0];

          const threshold = (toolName === 'chat-on-web' || toolName === 'chat-on-discord')
            ? GRAPH_CONFIG.REPEAT_CHAT_THRESHOLD
            : GRAPH_CONFIG.REPEAT_ACTION_THRESHOLD;

          if (actionHistory.length >= threshold) {
            const repeatCount = actionHistory.slice(-threshold).filter((a: string) => a === lastAction).length;
            if (repeatCount >= threshold) {
              console.log(
                `\x1b[33m⚠ 同じアクション（${toolName}）が${repeatCount}回連続で成功。終了します。\x1b[0m`
              );
              return END;
            }
          }
        }

        // planningに戻る
        return 'planning';
      });

    return workflow.compile();
  }

  /**
   * タスクを実行
   */
  public async invoke(partialState: TaskStateInput) {
    // 排他制御
    if (this.isExecuting) {
      console.log('\x1b[33m⚠️ タスク実行中のため、新しいタスクをスキップします\x1b[0m');
      return null;
    }

    this.isExecuting = true;
    this.recentSuccessfulActions = [];

    // コンテキストの正規化
    let context = partialState.context;
    if (!context && partialState.memoryZone) {
      context = memoryZoneToContext(partialState.memoryZone, partialState.channelId || undefined);
    }

    let state: typeof this.TaskState.State = {
      taskId: crypto.randomUUID(),
      context: context || null,
      memoryZone: partialState.memoryZone ?? 'web',
      channelId: partialState.channelId ?? null,
      environmentState: partialState.environmentState ?? null,
      selfState: partialState.selfState ?? null,
      humanFeedback: partialState.humanFeedback ?? null,
      selfFeedback: partialState.selfFeedback ?? null,
      messages: partialState.messages ?? [],
      userMessage: partialState.userMessage ?? null,
      emotion: partialState.emotion ?? null,
      taskTree: partialState.taskTree ?? {
        status: 'in_progress',
        goal: '',
        strategy: '',
        subTasks: null,
      },
      humanFeedbackPending: false,
      forceStop: false,
      retryCount: partialState.retryCount ?? 0,
      executionResults: null,
      isEmergency: partialState.isEmergency ?? false,
    };

    this.currentState = state;

    try {
      console.log('🚀 タスクグラフ実行開始 ID:', state.taskId);
      const result = await this.graph.invoke(state, {
        recursionLimit: GRAPH_CONFIG.RECURSION_LIMIT,
      });

      if (result.taskTree?.status === 'in_progress') {
        result.taskTree.status = 'error';
      }

      console.log('✅ タスクグラフ完了:', {
        taskId: result.taskId,
        status: result.taskTree?.status,
        messageCount: result.messages.length,
      });

      this.currentState = result;
      return result;
    } catch (error) {
      if (error instanceof Error && 'lc_error_code' in error) {
        if ((error as any).lc_error_code === 'GRAPH_RECURSION_LIMIT') {
          console.warn('再帰制限に達しました。タスクを強制終了します。');
          return {
            ...state,
            taskTree: {
              status: 'error',
              goal: '再帰制限エラーにより強制終了',
              strategy: '',
              subTasks: null,
            },
          };
        }
      }

      console.error('タスクグラフ実行エラー:', error);
      return {
        ...state,
        taskTree: {
          status: 'error',
          goal: `エラー: ${error instanceof Error ? error.message : '不明なエラー'}`,
          strategy: '',
          subTasks: null,
        },
      };
    } finally {
      this.isExecuting = false;

      if (partialState.isEmergency || this.isEmergencyMode) {
        console.log('\x1b[33m🚨 緊急タスク終了\x1b[0m');
        this.isEmergencyMode = false;
        this.emergencyTask = null;
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
  }

  /**
   * humanFeedbackを更新
   */
  public updateHumanFeedback(feedback: string) {
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
  public addTaskToQueue(taskInput: TaskStateInput): { success: boolean; reason?: string; taskId?: string } {
    if (this.taskQueue.length >= GRAPH_CONFIG.MAX_QUEUE_SIZE) {
      return {
        success: false,
        reason: 'タスクキューがいっぱいです。'
      };
    }

    const taskId = crypto.randomUUID();
    const task: TaskQueueEntry = {
      id: taskId,
      taskTree: taskInput.taskTree || { goal: taskInput.userMessage || 'New Task', status: 'pending' } as any,
      state: taskInput,
      createdAt: Date.now(),
      status: 'pending',
    };

    this.taskQueue.push(task);
    console.log(`\x1b[32m📥 タスクをキューに追加: "${task.taskTree?.goal}" (${this.taskQueue.length}/${GRAPH_CONFIG.MAX_QUEUE_SIZE})\x1b[0m`);

    this.notifyTaskListUpdate();

    if (this.taskQueue.length === 1 && !this.isExecuting && !this.isEmergencyMode) {
      this.executeNextTask();
    }

    return { success: true, taskId };
  }

  /**
   * タスクを削除
   */
  public removeTask(taskId: string): { success: boolean; reason?: string } {
    const taskIndex = this.taskQueue.findIndex(t => t.id === taskId);
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

    const nextTask = this.taskQueue.find(t => t.status === 'pending' || t.status === 'paused');
    if (!nextTask) {
      console.log('\x1b[33m📭 実行するタスクがありません\x1b[0m');
      return;
    }

    nextTask.status = 'executing';
    this.notifyTaskListUpdate();

    console.log(`\x1b[32m▶️ タスク実行開始: "${nextTask.taskTree?.goal}"\x1b[0m`);

    await this.invoke(nextTask.state);
    this.handleTaskCompletion(nextTask.id);
  }

  /**
   * タスク完了時の処理
   */
  private handleTaskCompletion(taskId: string): void {
    const taskIndex = this.taskQueue.findIndex(t => t.id === taskId);
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
      tasks: this.taskQueue.map(t => ({
        id: t.id,
        goal: t.taskTree?.goal || 'Unknown',
        status: t.status,
        createdAt: t.createdAt,
      })),
      emergencyTask: this.emergencyTask ? {
        id: this.emergencyTask.id,
        goal: this.emergencyTask.taskTree?.goal || 'Emergency',
        createdAt: this.emergencyTask.createdAt,
      } : null,
      currentTaskId: this.isExecuting
        ? (this.taskQueue.find(t => t.status === 'executing')?.id || null)
        : null,
    };
  }

  /**
   * タスクリスト更新コールバックを設定
   */
  public setTaskListUpdateCallback(callback: (tasks: TaskListState) => void): void {
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

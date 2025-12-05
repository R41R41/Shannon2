import { AIMessage, BaseMessage } from '@langchain/core/messages';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { TaskTreeState } from '@shannon/common';
import dotenv from 'dotenv';
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from '../../config/MinebotConfig.js';
import { CustomBot } from '../../types.js';
import { CentralLogManager } from './logging/index.js';
import { ExecutionNode } from './nodes/ExecutionNode.js';
import { PlanningNode } from './nodes/PlanningNode.js';
import { Prompt } from './prompt.js';
import { InstantSkillTool } from './tools/InstantSkillTool.js';
import { TaskStateInput } from './types.js';
import { convertToToolCalls } from './utils/argsParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

export class TaskGraph {
  private static instance: TaskGraph;
  private tools: any[] = [];
  private planningNode: PlanningNode | null = null;
  private executionNode: ExecutionNode | null = null;
  private centralLogManager: CentralLogManager;
  private graph: any;
  private prompt: Prompt | null = null;
  private bot: CustomBot | null = null;
  public currentState: any = null;

  // タスクスタック（緊急中断時に使用）
  private taskStack: Array<{
    taskTree: any;
    state: any;
    timestamp: number;
    reason: string;
  }> = [];
  private isEmergencyMode = false;
  private isExecuting = false; // タスク実行中フラグ（排他制御用）

  // 直近の成功アクション履歴（同じアクションの繰り返し検出用）
  private recentSuccessfulActions: string[] = [];

  constructor() {
    this.bot = null;
    this.planningNode = null;
    this.executionNode = null;
    this.centralLogManager = CentralLogManager.getInstance();
    this.prompt = null;
  }

  public async initialize(bot: CustomBot) {
    this.bot = bot;
    await this.initializeTools();
    this.prompt = new Prompt(this.tools);

    // ノードを初期化（2ノード構成: Planning + Execution）
    this.planningNode = new PlanningNode(this.bot, this.prompt, this.centralLogManager);
    this.executionNode = new ExecutionNode(this.tools, this.centralLogManager);

    this.graph = this.createGraph();
    this.currentState = null;
  }

  /**
   * 緊急状態解除ハンドラーを設定（TaskCoordinatorから呼ばれる）
   */
  public setEmergencyResolvedHandler(handler: () => Promise<void>): void {
    if (this.planningNode) {
      this.planningNode.setEmergencyResolvedHandler(handler);
    }
  }

  public static getInstance(): TaskGraph {
    if (!TaskGraph.instance) {
      TaskGraph.instance = new TaskGraph();
    }
    return TaskGraph.instance;
  }

  public async initializeTools() {
    if (!this.bot) {
      throw new Error('Bot not initialized');
    }
    // instantSkillsから全スキルを取得
    this.tools = [];
    const skills = this.bot.instantSkills.getSkills();
    for (const skill of skills) {
      if (!skill.isToolForLLM) continue;
      const skillTool = new InstantSkillTool(skill, this.bot);
      this.tools.push(skillTool);
    }
    const toolsDir = join(__dirname, '../tools');
    const toolFiles = readdirSync(toolsDir).filter(
      (file) =>
        (file.endsWith('.ts') || file.endsWith('.js')) &&
        !file.includes('.d.ts')
    );

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
    console.log('tools', this.tools.length);
  }

  private TaskState = Annotation.Root({
    taskId: Annotation<string>({
      reducer: (_, next) => next,
      default: () => '',
    }),
    environmentState: Annotation<string | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
    selfState: Annotation<string | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
    humanFeedback: Annotation<string | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
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
    taskTree: Annotation<TaskTreeState | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
    // humanFeedbackPendingフラグを追加
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
    // 実行結果（ExecutionNodeからPlanningNodeに渡す）
    executionResults: Annotation<any[] | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
  });

  private createGraph() {
    if (!this.planningNode || !this.executionNode) {
      throw new Error('Nodes not initialized');
    }

    const workflow = new StateGraph(this.TaskState)
      .addNode('planning', async (state) => {
        // humanFeedbackとretryCountを現在の状態から取得
        state.humanFeedback =
          this.currentState?.humanFeedback || state.humanFeedback;
        state.retryCount = this.currentState?.retryCount || state.retryCount || 0;

        // 前回の実行結果を引き継ぎ（あれば）
        if (this.currentState?.executionResults) {
          state.executionResults = this.currentState.executionResults;
        }

        // ゴールを設定
        if (state.userMessage) {
          this.centralLogManager.setCurrentGoal(state.userMessage);
        }

        const result = await this.planningNode!.invoke(state);

        // ログを送信
        await this.centralLogManager.sendNewLogsToUI();

        return result;
      })
      .addNode('execution', async (state) => {
        // nextActionSequence を取得
        const activeActionSequence = state.taskTree?.nextActionSequence || state.taskTree?.actionSequence;

        // 現在のサブタスク情報（表示用）
        let currentSubTaskInfo: { id: string; goal: string } | null = null;
        if (state.taskTree?.currentSubTaskId && state.taskTree?.hierarchicalSubTasks) {
          const currentSubTask = this.findSubTaskById(
            state.taskTree.hierarchicalSubTasks,
            state.taskTree.currentSubTaskId
          );
          if (currentSubTask) {
            currentSubTaskInfo = { id: currentSubTask.id, goal: currentSubTask.goal };
            console.log(`\x1b[36m📌 サブタスク実行中: ${currentSubTask.goal}\x1b[0m`);
          }
        }

        // アクションがない場合はそのまま返す
        if (!activeActionSequence || activeActionSequence.length === 0) {
          return state;
        }

        // actionSequence を AIMessage の tool_calls 形式に変換
        const toolCalls = convertToToolCalls(activeActionSequence);

        // AIMessage を作成して state.messages に追加
        const aiMessage = new AIMessage({
          content: '',
          tool_calls: toolCalls,
        });

        const updatedState = {
          ...state,
          messages: [...(state.messages || []), aiMessage],
        };

        // ExecutionNode で実行
        const result = await this.executionNode!.invoke(updatedState);

        // 実行結果を処理
        const hasError = result.hasError || false;
        let newRetryCount = state.retryCount || 0;
        let updatedTaskTree = { ...state.taskTree };

        if (hasError) {
          newRetryCount = newRetryCount + 1;
          this.currentState.retryCount = newRetryCount;

          // サブタスクのステータスを更新（失敗）
          if (currentSubTaskInfo && updatedTaskTree.hierarchicalSubTasks) {
            const errorMessage = result.executionResults?.find((r: any) => !r.success)?.message || 'Unknown error';
            updatedTaskTree.hierarchicalSubTasks = updatedTaskTree.hierarchicalSubTasks.map((st: any) => {
              if (st.id === currentSubTaskInfo!.id) {
                return {
                  ...st,
                  status: 'error',
                  failureReason: errorMessage,
                  needsDecomposition: true,
                };
              }
              return st;
            });
          }

          console.log(`\x1b[33m⚠ エラー発生（再試行回数: ${newRetryCount}/${CONFIG.MAX_RETRY_COUNT}）\x1b[0m`);
        } else {
          newRetryCount = 0;
          this.currentState.retryCount = 0;

          if (currentSubTaskInfo) {
            console.log(`\x1b[32m✓ サブタスク完了: ${currentSubTaskInfo.goal}\x1b[0m`);
          }
        }

        // 実行結果をcurrentStateに保存（次のPlanningで参照）
        this.currentState.executionResults = result.executionResults;

        return {
          ...result,
          retryCount: newRetryCount,
          taskTree: updatedTaskTree,
          executionResults: result.executionResults,
        };
      })
      .addEdge(START, 'planning')
      .addConditionalEdges('planning', (state) => {
        if (this.currentState.forceStop) {
          return END;
        }
        if (this.currentState.humanFeedbackPending) {
          this.currentState.humanFeedbackPending = false;
          return 'planning';
        }

        // === 問題3修正: status: completedの場合は即座に終了 ===
        if (state.taskTree?.status === 'completed') {
          console.log('\x1b[32m✅ タスク完了\x1b[0m');
          return END;
        }
        if (state.taskTree?.status === 'error') {
          console.log('\x1b[31m❌ タスクエラー\x1b[0m');
          return END;
        }

        // nextActionSequence または actionSequenceがある場合は実行
        const hasActions =
          (state.taskTree?.nextActionSequence && state.taskTree.nextActionSequence.length > 0) ||
          (state.taskTree?.actionSequence && state.taskTree.actionSequence.length > 0);

        if (hasActions) {
          return 'execution';
        }

        // actionSequenceもなく、statusも未完了の場合は終了
        console.log('\x1b[33m⚠ アクションなし、終了\x1b[0m');
        return END;
      })
      .addConditionalEdges('execution', (state) => {
        if (this.currentState.forceStop) {
          return END;
        }

        // retryCountをチェック（最大回数以上失敗したら終了）
        const retryCount = state.retryCount || 0;
        if (retryCount >= CONFIG.MAX_RETRY_COUNT) {
          console.log(
            `\x1b[31m✗ 最大再試行回数（${CONFIG.MAX_RETRY_COUNT}回）に達しました。タスクを終了します。\x1b[0m`
          );
          return END;
        }

        // 同じアクションの繰り返しを検出（無限ループ防止）
        const execResults = state.executionResults || [];
        const recentActions = this.recentSuccessfulActions || [];

        // 今回成功したアクションを履歴に追加
        const successfulActions = execResults.filter((r: any) => r.success).map((r: any) => r.toolName);
        if (successfulActions.length > 0) {
          this.recentSuccessfulActions = [...recentActions, ...successfulActions].slice(-10); // 直近10件保持
        }

        // 同じアクションが連続3回以上成功している場合は終了
        const actionHistory = this.recentSuccessfulActions || [];
        if (actionHistory.length >= 3) {
          const lastAction = actionHistory[actionHistory.length - 1];
          const repeatCount = actionHistory.slice(-5).filter((a: string) => a === lastAction).length;
          if (repeatCount >= 3) {
            console.log(
              `\x1b[33m⚠ 同じアクション（${lastAction}）が${repeatCount}回連続で成功。進展がないため終了します。\x1b[0m`
            );
            return END;
          }
        }

        if (this.currentState.humanFeedbackPending) {
          this.currentState.humanFeedbackPending = false;
          return 'planning';
        }

        // エラーがある場合は必ずplanningに戻る
        // 成功の場合もplanningに戻って最終判定を行う
        return 'planning';
      });
    return workflow.compile();
  }

  public async invoke(partialState: TaskStateInput) {
    // 排他制御: 既に実行中なら新しいタスクを開始しない
    if (this.isExecuting) {
      console.log('\x1b[33m⚠️ タスク実行中のため、新しいタスクをスキップします\x1b[0m');
      return null;
    }

    this.isExecuting = true;

    // 新しいタスク開始時にアクション履歴をリセット
    this.recentSuccessfulActions = [];

    let state: typeof this.TaskState.State = {
      taskId: crypto.randomUUID(),
      environmentState: partialState.environmentState ?? null,
      selfState: partialState.selfState ?? null,
      humanFeedback: partialState.humanFeedback ?? null,
      messages: partialState.messages ?? [],
      userMessage: partialState.userMessage ?? null,
      taskTree: {
        status: 'in_progress',
        goal: '',
        strategy: '',
        subTasks: null,
      },
      humanFeedbackPending: false,
      forceStop: false,
      retryCount: 0,
      executionResults: null,
    };
    this.currentState = state;

    try {
      console.log('タスクグラフ実行開始 ID:', state.taskId);
      const result = await this.graph.invoke(state, { recursionLimit: CONFIG.LANGGRAPH_RECURSION_LIMIT });
      if (result.taskTree?.status === 'in_progress') {
        result.taskTree.status = 'error';
      }

      // 実行後の状態サマリーをログ出力
      console.log('タスクグラフ完了:', {
        taskId: result.taskId,
        status: result.taskTree?.status,
        wasForceStop: result.forceStop,
        messageCount: result.messages.length,
      });

      this.currentState = result;

      return result;
    } catch (error) {
      // 再帰制限エラーの場合
      if (error instanceof Error && 'lc_error_code' in error) {
        if (error.lc_error_code === 'GRAPH_RECURSION_LIMIT') {
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

      // その他のエラーの場合
      console.error('タスクグラフ実行エラー:', error);
      return {
        ...state,
        taskTree: {
          status: 'error',
          goal: `エラーにより強制終了: ${error instanceof Error ? error.message : '不明なエラー'
            }`,
          strategy: '',
          subTasks: null,
        },
      };
    } finally {
      // 排他制御を解除
      this.isExecuting = false;
    }
  }

  // humanFeedbackを更新
  public updateHumanFeedback(feedback: string) {
    console.log('updateHumanFeedback', feedback);
    if (this.currentState) {
      this.currentState.humanFeedback = feedback;
      this.currentState.humanFeedbackPending = true;
      console.log('humanFeedbackが更新されました:', feedback);
    }
  }

  // タスクを強制終了
  public forceStop() {
    console.log('forceStop');
    if (this.currentState) {
      this.currentState.forceStop = true;
    }
  }

  /**
   * タスクが実行中かどうかを返す
   */
  public isRunning(): boolean {
    return this.isExecuting;
  }

  /**
   * 現在のタスクをスタックに保存（緊急中断時）
   */
  private pushCurrentTask(reason: string): void {
    if (this.currentState?.taskTree) {
      console.log(`\x1b[33m📚 タスクをスタックに保存: ${this.currentState.taskTree.goal}\x1b[0m`);

      this.taskStack.push({
        taskTree: { ...this.currentState.taskTree },
        state: {
          retryCount: this.currentState.retryCount || 0,
          humanFeedback: this.currentState.humanFeedback,
          userMessage: this.currentState.userMessage,
        },
        timestamp: Date.now(),
        reason,
      });
    }
  }

  /**
   * スタックから前のタスクを復元
   */
  private popPreviousTask(): any | null {
    if (this.taskStack.length === 0) {
      return null;
    }

    const previousTask = this.taskStack.pop()!;
    const elapsed = ((Date.now() - previousTask.timestamp) / 1000).toFixed(1);
    console.log(`\x1b[32m📖 タスクを復元: "${previousTask.taskTree.goal}" (中断時間: ${elapsed}秒)\x1b[0m`);

    return {
      taskTree: previousTask.taskTree,
      retryCount: previousTask.state.retryCount,
      userMessage: previousTask.state.userMessage,
      humanFeedback: `緊急対応が完了しました。元のタスク「${previousTask.taskTree.goal}」の続きを実行してください。`,
      resuming: true,
    };
  }

  /**
   * 階層的サブタスクからIDで検索（再帰的）
   */
  private findSubTaskById(tasks: any[], id: string): any | null {
    for (const task of tasks) {
      if (task.id === id) {
        return task;
      }
      if (task.children && task.children.length > 0) {
        const found = this.findSubTaskById(task.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * ボットの制御をクリア
   */
  private clearBotControls(): void {
    if (!this.bot) return;

    try {
      this.bot.clearControlStates();
      const pathfinder = (this.bot as any).pathfinder;
      if (pathfinder) {
        pathfinder.setGoal(null);
      }
    } catch (error) {
      console.error('制御クリアエラー:', error);
    }
  }

  /**
   * 緊急事態で現在のタスクを中断
   */
  public interruptForEmergency(emergencyMessage: string): void {
    if (this.currentState?.taskTree && !this.isEmergencyMode) {
      // 現在のタスクをスタックに保存
      this.pushCurrentTask('emergency');
      this.isEmergencyMode = true;

      console.log('\x1b[31m⚠️ タスクを緊急中断しました\x1b[0m');

      // 実行中の pathfinder や制御をクリア
      this.clearBotControls();
    }
  }

  /**
   * 緊急タスク完了後、元のタスクに復帰
   */
  public async resumePreviousTask(): Promise<void> {
    const previousTask = this.popPreviousTask();

    if (!previousTask) {
      console.log('\x1b[33m復帰するタスクがありません\x1b[0m');
      this.isEmergencyMode = false;
      return;
    }

    this.isEmergencyMode = false;

    // 元のタスクを再開
    console.log(`\x1b[32m🔄 タスク復帰を開始...\x1b[0m`);

    this.invoke(previousTask);
  }

  /**
   * タスクスタックをクリア
   */
  public clearTaskStack(): void {
    if (this.taskStack.length > 0) {
      console.log(`\x1b[33mタスクスタックをクリア (${this.taskStack.length}個のタスク)\x1b[0m`);
      this.taskStack = [];
    }
    this.isEmergencyMode = false;
  }

  /**
   * 緊急モードかどうか
   */
  public isInEmergencyMode(): boolean {
    return this.isEmergencyMode;
  }
}

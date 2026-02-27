import { AIMessage, BaseMessage } from '@langchain/core/messages';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { TaskTreeState } from '@shannon/common';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../../../../utils/logger.js';
import { loadToolsFromDirectory } from '../../../../utils/toolLoader.js';
import { CONFIG } from '../../config/MinebotConfig.js';
import { CustomBot } from '../../types.js';
import { CentralLogManager } from './logging/index.js';
import { ExecutionNode } from './nodes/ExecutionNode.js';
import { FunctionCallingAgent } from './nodes/FunctionCallingAgent.js';
import { PlanningNode } from './nodes/PlanningNode.js';
import { Prompt } from './prompt.js';
import { InstantSkillTool } from './tools/InstantSkillTool.js';
import { UpdatePlanTool } from './tools/UpdatePlanTool.js';
import { TaskStateInput } from './types.js';
import { convertToToolCalls } from './utils/argsParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const log = createLogger('Minebot:TaskGraph');

export class TaskGraph {
  private static instance: TaskGraph;
  private tools: any[] = [];
  private planningNode: PlanningNode | null = null;
  private executionNode: ExecutionNode | null = null;
  private functionCallingAgent: FunctionCallingAgent | null = null;
  private centralLogManager: CentralLogManager;
  private graph: any;
  private prompt: Prompt | null = null;
  private bot: CustomBot | null = null;
  public currentState: any = null;

  // Function Calling モード切替フラグ
  // true: 新方式（Function Calling Agent）- 高速・省コンテキスト
  // false: 旧方式（LangGraph PlanningNode + ExecutionNode）
  private useFunctionCalling: boolean = CONFIG.USE_FUNCTION_CALLING;

  // タスクスタック（緊急中断時に使用 - 非推奨、taskQueueに移行）
  private taskStack: Array<{
    taskTree: any;
    state: any;
    timestamp: number;
    reason: string;
  }> = [];

  // タスクキュー（最大3つ + 緊急1つ）
  private static readonly MAX_QUEUE_SIZE = 3;
  private taskQueue: Array<{
    id: string;
    taskTree: any;
    state: any;
    createdAt: number;
    status: 'pending' | 'executing' | 'paused';
  }> = [];
  private emergencyTask: {
    id: string;
    taskTree: any;
    state: any;
    createdAt: number;
  } | null = null;

  private isEmergencyMode = false;
  private isExecuting = false; // タスク実行中フラグ（排他制御用）
  private abortController: AbortController | null = null; // LLM呼び出しキャンセル用

  // 直近の成功アクション履歴（同じアクションの繰り返し検出用）
  private recentSuccessfulActions: string[] = [];

  // タスクリスト更新コールバック
  private onTaskListUpdate: ((tasks: any) => void) | null = null;

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

    // Function Calling Agent を初期化
    this.functionCallingAgent = new FunctionCallingAgent(
      this.bot,
      this.tools,
      this.centralLogManager,
    );

    this.graph = this.createGraph();
    this.currentState = null;

    log.info(`📦 Mode: ${this.useFunctionCalling ? 'FunctionCalling' : 'LangGraph'}`, 'cyan');
  }

  /**
   * 緊急状態解除ハンドラーを設定（TaskCoordinatorから呼ばれる）
   */
  public setEmergencyResolvedHandler(handler: () => Promise<void>): void {
    if (this.planningNode) {
      this.planningNode.setEmergencyResolvedHandler(handler);
    }
    if (this.functionCallingAgent) {
      this.functionCallingAgent.setEmergencyResolvedHandler(handler);
    }
  }

  /**
   * 音声応答コールバックを設定（Minebot音声モード用）
   * FCAがテキスト応答を生成した際にコールバックを発火する
   */
  public setOnResponseText(callback: ((text: string) => void) | null): void {
    if (this.functionCallingAgent) {
      this.functionCallingAgent.setOnResponseText(callback);
    }
  }

  /**
   * Function Calling モードの切り替え
   */
  public setUseFunctionCalling(value: boolean): void {
    this.useFunctionCalling = value;
    log.info(`📦 Mode: ${value ? 'FunctionCalling' : 'LangGraph'}`, 'cyan');
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
    const fileTools = await loadToolsFromDirectory(toolsDir, 'Minebot');
    this.tools.push(...fileTools);

    // update-plan ツールを追加（Function Calling Agent 用）
    this.tools.push(new UpdatePlanTool());

    log.info(`🔧 Loaded ${this.tools.length} tools`);
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
    // 緊急タスクフラグ
    isEmergency: Annotation<boolean>({
      reducer: (_, next) => next,
      default: () => false,
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
            log.info(`📌 サブタスク実行中: ${currentSubTask.goal}`, 'cyan');
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

          log.warn(`⚠ エラー発生（再試行回数: ${newRetryCount}/${CONFIG.MAX_RETRY_COUNT}）`);
        } else {
          newRetryCount = 0;
          this.currentState.retryCount = 0;

          if (currentSubTaskInfo) {
            log.success(`✓ サブタスク完了: ${currentSubTaskInfo.goal}`);
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

        // nextActionSequenceがあるかチェック
        const hasActions =
          (state.taskTree?.nextActionSequence && state.taskTree.nextActionSequence.length > 0) ||
          (state.taskTree?.actionSequence && state.taskTree.actionSequence.length > 0);

        // status: completed/error でも残りアクション（chat報告等）があれば先に実行
        if (state.taskTree?.status === 'completed') {
          if (hasActions) {
            log.success('✅ タスク完了（残りアクションを実行してから終了）');
            return 'execution';
          }
          log.success('✅ タスク完了');
          return END;
        }
        if (state.taskTree?.status === 'error') {
          if (hasActions) {
            log.error('❌ タスクエラー（残りアクションを実行してから終了）');
            return 'execution';
          }
          log.error('❌ タスクエラー');
          return END;
        }

        if (hasActions) {
          return 'execution';
        }

        // actionSequenceもなく、statusも未完了の場合は終了
        log.warn('⚠ アクションなし、終了');
        return END;
      })
      .addConditionalEdges('execution', (state) => {
        if (this.currentState.forceStop) {
          return END;
        }

        // retryCountをチェック（最大回数以上失敗したら終了）
        const retryCount = state.retryCount || 0;
        if (retryCount >= CONFIG.MAX_RETRY_COUNT) {
          log.error(`✗ 最大再試行回数（${CONFIG.MAX_RETRY_COUNT}回）に達しました。タスクを終了します。`);
          return END;
        }

        // 同じアクションの繰り返しを検出（無限ループ防止）
        const execResults = state.executionResults || [];
        const recentActions = this.recentSuccessfulActions || [];

        // 今回成功したアクションを履歴に追加（ツール名+引数のハッシュ）
        const successfulActions = execResults
          .filter((r: any) => r.success)
          .map((r: any) => {
            const args = r.args || {};
            let actionKey: string;

            // 座標を含む引数がある場合は、ツール名+座標で識別
            // deposit/withdraw/tradeなど、アイテム名がある場合はそれも含める
            if (args.x !== undefined && args.y !== undefined && args.z !== undefined) {
              const itemSuffix = args.itemName ? `:${args.itemName}` : '';
              actionKey = `${r.toolName}@${args.x},${args.y},${args.z}${itemSuffix}`;
            }
            // chatアクションの場合は、メッセージ内容のハッシュで識別
            else if (r.toolName === 'chat' && args.message) {
              // メッセージの最初の50文字で識別（長いメッセージは短縮）
              const msgKey = args.message.substring(0, 50);
              actionKey = `${r.toolName}@${msgKey}`;
            }
            else {
              actionKey = r.toolName;
            }
            return actionKey;
          });
        if (successfulActions.length > 0) {
          this.recentSuccessfulActions = [...recentActions, ...successfulActions].slice(-15); // 直近15件保持
        }

        // 同じアクションが連続で成功している場合は終了
        // chatは2回、その他は5回で検出
        const actionHistory = this.recentSuccessfulActions || [];
        if (actionHistory.length >= 2) {
          const lastAction = actionHistory[actionHistory.length - 1];
          const toolName = lastAction.split('@')[0];

          // chatアクションは2回で終了（同じメッセージを何度も送る意味がない）
          const threshold = toolName === 'chat' ? 2 : 5;

          if (actionHistory.length >= threshold) {
            const repeatCount = actionHistory.slice(-threshold).filter((a: string) => a === lastAction).length;
            if (repeatCount >= threshold) {
              log.warn(`⚠ 同じアクション（${toolName}）が${repeatCount}回連続で成功。進展がないため終了します。`);
              return END;
            }
          }
        }

        // completed/error 状態で残りアクションを実行した後は終了
        if (state.taskTree?.status === 'completed') {
          log.success('✅ タスク完了（最終アクション実行済み）');
          return END;
        }
        if (state.taskTree?.status === 'error') {
          log.error('❌ タスクエラー（最終アクション実行済み）');
          return END;
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
      log.warn('⚠️ タスク実行中のため、新しいタスクをスキップします');
      return null;
    }

    this.isExecuting = true;
    this.abortController = new AbortController();

    // 新しいタスク開始時にアクション履歴をリセット
    this.recentSuccessfulActions = [];

    // 元のタスクを復元する場合はtaskTreeを引き継ぐ
    const isResuming = partialState.taskTree && partialState.taskTree.goal;

    let state: typeof this.TaskState.State = {
      taskId: isResuming ? `${crypto.randomUUID()}-resumed` : crypto.randomUUID(),
      environmentState: partialState.environmentState ?? null,
      selfState: partialState.selfState ?? null,
      humanFeedback: partialState.humanFeedback ?? null,
      messages: partialState.messages ?? [],
      userMessage: partialState.userMessage ?? null,
      taskTree: isResuming
        ? {
          status: 'in_progress' as const, // 再開時はin_progressに戻す
          goal: partialState.taskTree!.goal,
          strategy: partialState.taskTree!.strategy || '',
          hierarchicalSubTasks: partialState.taskTree!.hierarchicalSubTasks,
          currentSubTaskId: partialState.taskTree!.currentSubTaskId,
          nextActionSequence: null, // 再開時はPlanningNodeで再計画
          actionSequence: null,
          subTasks: partialState.taskTree!.subTasks,
          error: null,
        }
        : {
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

    if (isResuming) {
      log.success(`📖 元タスクを復元: "${partialState.taskTree?.goal}"`);
    }
    this.currentState = state;

    const invokeStartTime = Date.now();

    try {
      log.info(`🚀 タスクグラフ実行開始 ID: ${state.taskId}`);

      let result;

      if (this.useFunctionCalling && this.functionCallingAgent) {
        // === Function Calling モード ===
        log.info('🤖 Function Calling モードで実行', 'cyan');
        const agentResult = await this.functionCallingAgent.run(
          state,
          this.abortController?.signal,
        );
        result = {
          ...state,
          taskTree: agentResult.taskTree,
          messages: agentResult.messages || state.messages || [],
          forceStop: agentResult.forceStop,
          isEmergency: agentResult.isEmergency,
        };
      } else {
        // === 旧方式: LangGraph モード ===
        log.info('📊 LangGraph モードで実行', 'cyan');
        result = await this.graph.invoke(state, {
          recursionLimit: CONFIG.LANGGRAPH_RECURSION_LIMIT,
          signal: this.abortController?.signal,
        });
      }

      if (result.taskTree?.status === 'in_progress') {
        result.taskTree.status = 'error';
      }

      log.info(`タスクグラフ完了: taskId=${result.taskId}, status=${result.taskTree?.status}, messages=${result.messages?.length || 0}, elapsed=${Date.now() - invokeStartTime}ms`);

      this.currentState = result;

      return result;
    } catch (error) {
      // AbortError（forceStopによるキャンセル）の場合
      if (error instanceof Error && (error.name === 'AbortError' || error.message?.includes('aborted') || error.message?.includes('abort'))) {
        log.warn('⚠️ タスクが強制停止されました（AbortError）');
        return {
          ...state,
          forceStop: true,
          taskTree: {
            status: 'error',
            goal: state.taskTree?.goal || '強制停止',
            strategy: '',
            subTasks: null,
          },
        };
      }

      // 再帰制限エラーの場合
      if (error instanceof Error && 'lc_error_code' in error) {
        if ((error as any).lc_error_code === 'GRAPH_RECURSION_LIMIT') {
          log.warn('再帰制限に達しました。タスクを強制終了します。');
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
      log.error('タスクグラフ実行エラー', error);
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
      this.abortController = null;

      // 緊急タスク完了時はemergencyModeをリセット
      // partialState.isEmergency または this.isEmergencyMode がtrueなら緊急タスク
      if (partialState.isEmergency || this.isEmergencyMode) {
        log.warn('🚨 緊急タスク終了、emergencyModeをリセット');
        this.isEmergencyMode = false;

        // 緊急タスク完了をUIに通知してから少し待ってクリア
        // （UIが表示を更新する時間を確保）
        if (this.emergencyTask) {
          this.emergencyTask.taskTree.status = 'completed';
          this.notifyTaskListUpdate();

          // 1秒後にemergencyTaskをクリア
          setTimeout(() => {
            this.emergencyTask = null;
            this.notifyTaskListUpdate();
          }, 1000);
        }
      }

      // キューに待機中のタスクがあれば次を実行
      const hasPendingTasks = this.taskQueue.some(t => t.status === 'pending' || t.status === 'paused');
      if (hasPendingTasks && !this.isEmergencyMode) {
        log.info('📋 キューに待機中タスクあり、次のタスクを実行', 'cyan');
        // 少し遅延して次のタスクを開始（現在のスタックを抜けてから）
        setTimeout(() => this.executeNextTask(), 100);
      }
    }
  }

  /** FunctionCallingAgent がユーザーの応答を待機中かどうか */
  public get isAgentWaitingForResponse(): boolean {
    return this.functionCallingAgent?.isWaitingForResponse ?? false;
  }

  // humanFeedbackを更新
  public updateHumanFeedback(feedback: string) {
    log.info(`📝 humanFeedback updated: ${feedback}`);

    // Function Calling モードの場合はエージェントに直接フィードバック
    if (this.useFunctionCalling && this.functionCallingAgent) {
      this.functionCallingAgent.addFeedback(feedback);
    }

    if (this.currentState) {
      this.currentState.humanFeedback = feedback;
      this.currentState.humanFeedbackPending = true;
    }
    // 実行中のスキルに中断シグナルを送る
    if (this.bot && this.bot.executingSkill) {
      this.bot.interruptExecution = true;
      log.info('⚡ 実行中スキルに中断シグナルを送信');
    }
  }

  // タスクを強制終了
  public forceStop() {
    log.warn('⚠️ forceStop requested');
    if (this.currentState) {
      this.currentState.forceStop = true;
    }
    // 進行中のLLM呼び出しをキャンセル
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * 死亡によりタスクを失敗としてマーク
   */
  public failCurrentTaskDueToDeath(deathReason: string): void {
    log.error(`💀 タスク失敗（死亡）: ${deathReason}`);

    if (this.currentState?.taskTree) {
      // 現在のサブタスクを失敗としてマーク
      if (this.currentState.taskTree.currentSubTaskId && this.currentState.taskTree.hierarchicalSubTasks) {
        const updateSubTask = (tasks: any[]): boolean => {
          for (const task of tasks) {
            if (task.id === this.currentState!.taskTree!.currentSubTaskId) {
              task.status = 'error';
              task.failureReason = `死亡: ${deathReason}`;
              return true;
            }
            if (task.children && updateSubTask(task.children)) {
              return true;
            }
          }
          return false;
        };
        updateSubTask(this.currentState.taskTree.hierarchicalSubTasks);
      }

      // タスク全体をエラーに
      this.currentState.taskTree.status = 'error';
      this.currentState.taskTree.error = `死亡によりタスク失敗: ${deathReason}`;
    }

    // 強制終了
    this.forceStop();

    // 緊急モードをリセット
    this.isEmergencyMode = false;
    this.emergencyTask = null;

    // タスクキューから実行中のタスクを削除
    const executingIndex = this.taskQueue.findIndex(t => t.status === 'executing');
    if (executingIndex !== -1) {
      this.taskQueue.splice(executingIndex, 1);
    }

    this.notifyTaskListUpdate();
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
      log.warn(`📚 タスクをスタックに保存: ${this.currentState.taskTree.goal}`);

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
    log.success(`📖 タスクを復元: "${previousTask.taskTree.goal}" (中断時間: ${elapsed}秒)`);

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
      // 移動制御をクリア
      this.bot.clearControlStates();

      const pathfinder = (this.bot as any).pathfinder;
      if (pathfinder) {
        // pathfinderを停止
        pathfinder.stop();
        pathfinder.setGoal(null);
      }

      // collectBlockも停止
      const collectBlock = (this.bot as any).collectBlock;
      if (collectBlock) {
        collectBlock.cancelTask();
      }

      log.warn('⏹️ ボット制御を停止しました');
    } catch (error) {
      log.error('制御クリアエラー', error);
    }
  }

  /**
   * 緊急事態で現在のタスクを中断（キュー管理対応）
   */
  public interruptForEmergency(emergencyMessage: string): void {
    if (this.isEmergencyMode) {
      log.warn('⚠️ 既に緊急モード中です（緊急タスクを上書き）');
      // 既存の緊急タスクは上書きされる
    }

    // 現在実行中のタスクを「paused」状態にする
    const executingTask = this.taskQueue.find(t => t.status === 'executing');
    if (executingTask) {
      executingTask.status = 'paused';
      executingTask.taskTree = this.currentState?.taskTree || executingTask.taskTree;
      log.warn(`⏸️ タスクを一時停止: "${executingTask.taskTree?.goal}"`);
    }

    this.isEmergencyMode = true;

    // 実行中の pathfinder や制御をクリア
    this.clearBotControls();

    // forceStopで現在の実行を止める
    if (this.isExecuting) {
      this.forceStop();
    }

    log.error('⚠️ 緊急タスクを開始します');
    this.notifyTaskListUpdate();
  }

  /**
   * 緊急タスクを設定して実行
   */
  public setEmergencyTask(taskInput: TaskStateInput): void {
    const goal = taskInput.userMessage || 'Emergency';
    log.error(`🚨 緊急タスクを設定: "${goal}"`);

    this.emergencyTask = {
      id: crypto.randomUUID(),
      taskTree: { goal, status: 'executing' },
      state: taskInput,
      createdAt: Date.now(),
    };

    this.notifyTaskListUpdate();
  }

  /**
   * 緊急タスク完了後、元のタスクに復帰（キュー管理対応）
   * 注意: この関数はPlanningNode内（invoke実行中）から呼ばれる場合がある。
   * isExecuting は invoke() の finally ブロックで自動的にリセットされるため、
   * ここでは手動設定しない（二重実行の原因になる）。
   */
  public async resumePreviousTask(): Promise<void> {
    // 緊急タスクをクリア
    this.emergencyTask = null;
    this.isEmergencyMode = false;
    // 注意: this.isExecuting = false はここでしない！
    // invoke() の finally ブロックが自動的にリセットし、
    // そこで executeNextTask() も呼ばれる。

    log.success('✅ 緊急タスク完了、通常タスクを再開');
    this.notifyTaskListUpdate();

    // invoke() が完了した後に finally ブロックが executeNextTask() を呼ぶので、
    // ここでの明示的な呼び出しは不要。
    // ただし、invoke() 外から呼ばれた場合のフォールバック:
    // isExecuting が既に false なら次のタスクを開始する
    if (!this.isExecuting) {
      await new Promise(resolve => setTimeout(resolve, 500));
      this.executeNextTask();
    }
  }

  /**
   * タスクスタックをクリア
   */
  public clearTaskStack(): void {
    if (this.taskStack.length > 0) {
      log.warn(`タスクスタックをクリア (${this.taskStack.length}個のタスク)`);
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

  // ========== タスクキュー管理 ==========

  /**
   * タスクリスト更新コールバックを設定
   */
  public setTaskListUpdateCallback(callback: (tasks: any) => void): void {
    this.onTaskListUpdate = callback;
  }

  /**
   * タスクリストの状態を取得
   */
  public getTaskListState(): {
    tasks: Array<{
      id: string;
      goal: string;
      status: 'pending' | 'executing' | 'paused';
      createdAt: number;
    }>;
    emergencyTask: {
      id: string;
      goal: string;
      createdAt: number;
    } | null;
    currentTaskId: string | null;
  } {
    const tasks = this.taskQueue.map(t => ({
      id: t.id,
      goal: t.taskTree?.goal || 'Unknown',
      status: t.status,
      createdAt: t.createdAt,
    }));

    return {
      tasks,
      emergencyTask: this.emergencyTask ? {
        id: this.emergencyTask.id,
        goal: this.emergencyTask.taskTree?.goal || 'Emergency',
        createdAt: this.emergencyTask.createdAt,
      } : null,
      currentTaskId: this.isExecuting ? (this.taskQueue.find(t => t.status === 'executing')?.id || null) : null,
    };
  }

  /**
   * タスクをキューに追加（最大3つ）
   * @returns { success: boolean, reason?: string }
   */
  public addTaskToQueue(taskInput: TaskStateInput): { success: boolean; reason?: string; taskId?: string } {
    if (this.taskQueue.length >= TaskGraph.MAX_QUEUE_SIZE) {
      log.warn('⚠️ タスクキューがいっぱいです（最大3つ）');
      return {
        success: false,
        reason: 'タスクキューがいっぱいです。既存のタスクを削除してから新しいタスクを追加してください。'
      };
    }

    const taskId = crypto.randomUUID();
    const task = {
      id: taskId,
      taskTree: taskInput.taskTree || { goal: taskInput.userMessage || 'New Task', status: 'pending' },
      state: taskInput,
      createdAt: Date.now(),
      status: 'pending' as const,
    };

    this.taskQueue.push(task);
    log.success(`📥 タスクをキューに追加: "${task.taskTree.goal}" (${this.taskQueue.length}/${TaskGraph.MAX_QUEUE_SIZE})`);

    this.notifyTaskListUpdate();

    // キューに1つしかない場合は即実行
    if (this.taskQueue.length === 1 && !this.isExecuting && !this.isEmergencyMode) {
      this.executeNextTask();
    }

    return { success: true, taskId };
  }

  /**
   * タスクを削除（強制終了）
   */
  public removeTask(taskId: string): { success: boolean; reason?: string } {
    // 緊急タスクの削除
    if (this.emergencyTask?.id === taskId) {
      log.error(`🚨 緊急タスクを削除: "${this.emergencyTask.taskTree?.goal}"`);
      this.emergencyTask = null;
      this.isEmergencyMode = false;

      // 緊急タスク実行中だった場合は停止
      if (this.isExecuting) {
        this.clearBotControls(); // pathfinderと制御状態をクリア
        this.forceStop();
      }

      this.notifyTaskListUpdate();

      // 通常タスクを再開
      this.executeNextTask();
      return { success: true };
    }

    // 通常タスクの削除
    const taskIndex = this.taskQueue.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
      return { success: false, reason: 'タスクが見つかりません' };
    }

    const task = this.taskQueue[taskIndex];
    const wasExecuting = task.status === 'executing';

    log.error(`🗑️ タスクを削除: "${task.taskTree?.goal}"`);
    this.taskQueue.splice(taskIndex, 1);

    // 実行中のタスクを削除した場合は停止
    if (wasExecuting && this.isExecuting) {
      this.clearBotControls(); // pathfinderと制御状態をクリア
      this.forceStop();
      // 注意: ここで executeNextTask() は呼ばない。
      // forceStop() → AbortError → invoke().finally が isExecuting = false にした後、
      // finally ブロック内で hasPendingTasks をチェックして executeNextTask() を呼ぶ。
      // 同期的に呼ぶと、isExecuting がまだ true のため無意味であり、
      // finally からも呼ばれて二重実行のリスクがある。
    }

    this.notifyTaskListUpdate();

    // 実行中でなかった（paused等）タスクの削除後、
    // まだ実行していないタスクがあれば開始
    if (!wasExecuting && !this.isExecuting && !this.isEmergencyMode) {
      const hasPending = this.taskQueue.some(t => t.status === 'pending' || t.status === 'paused');
      if (hasPending) {
        this.executeNextTask();
      }
    }

    return { success: true };
  }

  /**
   * タスクを優先実行（選択したタスクを先に実行）
   */
  public prioritizeTask(taskId: string): { success: boolean; reason?: string } {
    const taskIndex = this.taskQueue.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
      return { success: false, reason: 'タスクが見つかりません' };
    }

    if (taskIndex === 0 && this.taskQueue[0].status === 'executing') {
      return { success: false, reason: 'このタスクは既に実行中です' };
    }

    const task = this.taskQueue[taskIndex];

    // 現在実行中のタスクを一時停止
    const executingTask = this.taskQueue.find(t => t.status === 'executing');
    if (executingTask) {
      executingTask.status = 'paused';
      executingTask.taskTree = this.currentState?.taskTree || executingTask.taskTree;
      if (this.isExecuting) {
        this.forceStop();
      }
    }

    // タスクを先頭に移動
    this.taskQueue.splice(taskIndex, 1);
    this.taskQueue.unshift(task);

    log.info(`⏫ タスクを優先実行: "${task.taskTree?.goal}"`, 'magenta');
    this.notifyTaskListUpdate();

    // 緊急モードでなければ実行
    // forceStop() が呼ばれた場合、invoke().finally で isExecuting = false になった後に
    // executeNextTask() が呼ばれるので、ここでは isExecuting が false の場合のみ呼ぶ
    if (!this.isEmergencyMode && !this.isExecuting) {
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
      log.warn('📭 実行するタスクがありません');
      return;
    }

    const wasPaused = nextTask.status === 'paused';
    nextTask.status = 'executing';
    this.notifyTaskListUpdate();

    log.success(`▶️ タスク実行開始: "${nextTask.taskTree?.goal}"${wasPaused ? ' (再開)' : ''}`);

    // invokeを呼び出し
    await this.invoke({
      ...nextTask.state,
      taskTree: wasPaused ? nextTask.taskTree : undefined,
    });

    // タスク完了後の処理
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
        // エラーの場合はキューに残す（pausedに戻す）
        log.error(`❌ タスクエラー: "${task.taskTree?.goal}" - キューに残します`);
        task.status = 'paused';
        // タスクツリーの状態を更新
        task.taskTree = this.currentState?.taskTree || task.taskTree;
      } else {
        // 完了の場合はキューから削除
        log.success(`✅ タスク完了: "${task.taskTree?.goal}"`);
        this.taskQueue.splice(taskIndex, 1);
      }
    }

    this.notifyTaskListUpdate();

    // 次のタスクを実行（エラーの場合は自動実行しない）
    const taskStatus = this.currentState?.taskTree?.status;
    if (!this.isEmergencyMode && taskStatus !== 'error') {
      setTimeout(() => this.executeNextTask(), 500);
    }
  }

  /**
   * タスクリスト更新を通知
   */
  private notifyTaskListUpdate(): void {
    const state = this.getTaskListState();
    log.info(`📋 TaskList更新: tasks=${state.tasks.length}, emergency=${state.emergencyTask ? 'あり' : 'なし'}`, 'magenta');
    if (this.onTaskListUpdate) {
      this.onTaskListUpdate(state);
    }
  }
}

import { AIMessage, BaseMessage } from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { TaskTreeState } from '@shannon/common';
import dotenv from 'dotenv';
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Vec3 } from 'vec3';
import { z, ZodObject } from 'zod';
import { EventBus } from '../../../eventBus/eventBus.js';
import { getEventBus } from '../../../eventBus/index.js';
import { CONFIG } from '../../config/MinebotConfig.js';
import { CustomBot } from '../../types.js';
import { CustomToolNode } from './customToolNode.js';
import { CentralLogManager, LogSender } from './logging/index.js';
import { ExecutionNode } from './nodes/ExecutionNode.js';
import { PlanningNode } from './nodes/PlanningNode.js';
import { ReflectionNode } from './nodes/ReflectionNode.js';
import { UnderstandingNode } from './nodes/UnderstandingNode.js';
import { Prompt } from './prompt.js';
import { TaskStateInput } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

// 汎用的なInstantSkillToolクラス
class InstantSkillTool extends StructuredTool {
  name: string;
  description: string;
  schema: ZodObject<any>;
  private bot: CustomBot;

  constructor(skill: any, bot: CustomBot) {
    super();
    this.bot = bot;
    this.name = skill.skillName;
    this.description = skill.description;
    // paramsからzodスキーマを動的生成
    this.schema = z.object(
      Object.fromEntries(
        (skill.params || []).map((param: any) => {
          // 型に応じたzodスキーマを生成
          let zodType;
          switch (param.type) {
            case 'number':
              zodType = z.number();
              break;
            case 'Vec3':
              zodType = z.object({
                x: z.number(),
                y: z.number(),
                z: z.number(),
              });
              break;
            case 'boolean':
              zodType = z.boolean();
              break;
            case 'string':
              zodType = z.string();
              break;
            default:
              zodType = z.string();
          }

          // null許容を追加
          zodType = zodType.nullable();

          // デフォルト値があれば設定
          if (param.default !== undefined) {
            // anyでキャストして型の互換性問題を回避
            try {
              zodType = (zodType as any).default(param.default);
            } catch (error) {
              console.error(
                `\x1b[31mデフォルト値の設定に失敗しました: ${error}\x1b[0m`
              );
            }
          }

          // 説明を追加
          zodType = zodType.describe(param.description || '');

          return [param.name, zodType];
        })
      )
    );
  }

  async _call(data: any): Promise<string> {
    const skill = this.bot.instantSkills.getSkill(this.name);
    if (!skill) {
      return `${this.name}スキルが存在しません。`;
    }
    console.log(
      `\x1b[32m${skill.skillName}を実行します。パラメータ：${JSON.stringify(
        data
      )}\x1b[0m`
    );

    try {
      // スキルのパラメータ定義を取得
      const params = skill.params || [];
      const args = params.map((param) => {
        if (param.type === 'Vec3' && data[param.name]) {
          return new Vec3(
            data[param.name].x,
            data[param.name].y,
            data[param.name].z
          );
        } else if (param.type === 'boolean' && data[param.name] === 'true') {
          return true;
        } else if (param.type === 'boolean' && data[param.name] === 'false') {
          return false;
        } else {
          return data[param.name];
        }
      });
      // スキルを実行
      const result = await skill.run(...args);
      return typeof result === 'string'
        ? result
        : `結果: ${result.success ? '成功' : '失敗'} 詳細: ${result.result}`;
    } catch (error) {
      console.error(`${this.name}スキル実行エラー:`, error);
      return `スキル実行エラー: ${error}`;
    }
  }
}

export class TaskGraph {
  private static instance: TaskGraph;
  private tools: any[] = [];
  private customToolNode: CustomToolNode | null = null;
  private planningNode: PlanningNode | null = null;
  private executionNode: ExecutionNode | null = null;
  private understandingNode: UnderstandingNode | null = null;
  private reflectionNode: ReflectionNode | null = null;
  private centralLogManager: CentralLogManager;
  private logSender: LogSender;
  private graph: any;
  private eventBus: EventBus | null = null;
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

  constructor() {
    this.bot = null;
    this.eventBus = null;
    this.customToolNode = null;
    this.planningNode = null;
    this.executionNode = null;
    this.understandingNode = null;
    this.reflectionNode = null;
    this.centralLogManager = CentralLogManager.getInstance();
    this.logSender = LogSender.getInstance();
    this.prompt = null;
  }

  public async initialize(bot: CustomBot) {
    this.bot = bot;
    this.eventBus = getEventBus();
    await this.initializeTools();
    this.prompt = new Prompt(this.tools);

    // 各Nodeを初期化（CentralLogManagerを渡す）
    this.customToolNode = new CustomToolNode(this.tools);
    this.planningNode = new PlanningNode(this.bot, this.prompt, this.centralLogManager);
    this.executionNode = new ExecutionNode(this.bot, this.centralLogManager);
    this.understandingNode = new UnderstandingNode(this.bot, this.centralLogManager);
    this.reflectionNode = new ReflectionNode(this.bot, this.centralLogManager);

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
  });

  private createGraph() {
    if (!this.planningNode || !this.customToolNode) {
      throw new Error('Nodes not initialized');
    }

    const workflow = new StateGraph(this.TaskState)
      .addNode('planning', async (state) => {
        // humanFeedbackとretryCountを現在の状態から取得
        state.humanFeedback =
          this.currentState?.humanFeedback || state.humanFeedback;
        state.retryCount = this.currentState?.retryCount || state.retryCount || 0;

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
        // actionSequenceがある場合は、CustomToolNodeで実行
        if (
          state.taskTree?.actionSequence &&
          state.taskTree.actionSequence.length > 0
        ) {
          // 実行開始ログ
          this.centralLogManager.getLogManager('execution').addLog({
            phase: 'execution',
            level: 'info',
            source: 'custom_tool_node',
            content: `Executing ${state.taskTree.actionSequence.length} actions...`,
            metadata: {
              status: 'loading',
              actionCount: state.taskTree.actionSequence.length,
            } as any,
          });

          // ログを送信
          await this.centralLogManager.sendNewLogsToUI();

          // actionSequence を AIMessage の tool_calls 形式に変換
          const toolCalls = state.taskTree.actionSequence.map((action: any, index: number) => {
            // args が JSON 文字列の場合はパース、オブジェクトの場合はそのまま
            let parsedArgs = action.args;
            if (typeof action.args === 'string') {
              try {
                // 標準の JSON パース
                parsedArgs = JSON.parse(action.args);
              } catch (error) {
                // Python 辞書形式（シングルクォート）を試す
                try {
                  const fixedJson = action.args
                    .replace(/'/g, '"')  // シングルクォートをダブルクォートに
                    .replace(/True/g, 'true')  // Python の True を JSON の true に
                    .replace(/False/g, 'false')  // Python の False を JSON の false に
                    .replace(/None/g, 'null');  // Python の None を JSON の null に
                  parsedArgs = JSON.parse(fixedJson);
                  console.log(`\x1b[33m⚠ Python形式をJSON形式に変換しました: ${action.toolName}\x1b[0m`);
                } catch (error2) {
                  console.error(`\x1b[31m引数のJSONパースに失敗: ${action.args}\x1b[0m`);
                  console.error(`\x1b[31m  エラー: ${error2}\x1b[0m`);
                  parsedArgs = {};
                }
              }
            }

            return {
              name: action.toolName,
              args: parsedArgs,
              id: `call_${Date.now()}_${index}`,
            };
          });

          // AIMessage を作成して state.messages に追加
          const aiMessage = new AIMessage({
            content: '',
            tool_calls: toolCalls,
          });

          const updatedState = {
            ...state,
            messages: [...(state.messages || []), aiMessage],
          };

          const result = await this.customToolNode!.invoke(updatedState);

          // ツール実行結果からエラーを判定
          const messages = result.messages || [];
          const lastMessage = messages[messages.length - 1];
          let hasError = false;
          if (lastMessage && 'content' in lastMessage) {
            const content = String(lastMessage.content);
            hasError = content.includes('エラー') || content.includes('失敗') || content.includes('スキップ');
          }

          // retryCountを更新
          let newRetryCount = state.retryCount || 0;
          if (hasError) {
            newRetryCount = newRetryCount + 1;
            this.currentState.retryCount = newRetryCount;
            console.log(`\x1b[33m⚠ エラー発生（再試行回数: ${newRetryCount}/${CONFIG.MAX_RETRY_COUNT}）\x1b[0m`);

            // エラーログ
            this.centralLogManager.getLogManager('execution').addLog({
              phase: 'execution',
              level: 'error',
              source: 'custom_tool_node',
              content: `Action failed (Retry ${newRetryCount}/${CONFIG.MAX_RETRY_COUNT})`,
              metadata: {
                error: 'Action sequence failed',
              } as any,
            });
          } else {
            newRetryCount = 0;
            this.currentState.retryCount = 0;

            // 成功ログ
            this.centralLogManager.getLogManager('execution').addLog({
              phase: 'execution',
              level: 'success',
              source: 'custom_tool_node',
              content: `✅ All ${state.taskTree.actionSequence.length} actions completed successfully`,
              metadata: {} as any,
            });
          }

          // ログを送信
          await this.centralLogManager.sendNewLogsToUI();

          return { ...result, retryCount: newRetryCount };
        }

        // actionSequenceがない場合はそのまま返す
        return state;
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

        // actionSequenceがある場合は、statusに関係なくexecutionに進む
        if (
          state.taskTree?.actionSequence &&
          state.taskTree.actionSequence.length > 0
        ) {
          return 'execution';
        }

        if (
          state.taskTree?.status === 'completed' ||
          state.taskTree?.status === 'error'
        ) {
          console.log('\x1b[31mtaskTree completed\x1b[0m');
          return END;
        } else {
          // actionSequenceもなく、statusも未完了の場合は終了
          return END;
        }
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

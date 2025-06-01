import { AIMessage, BaseMessage, ToolMessage } from '@langchain/core/messages';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { ChatOpenAI } from '@langchain/openai';
import { TaskInput, TaskTreeState } from '@shannon/common';
import { TaskStateInput } from './types.js';
import dotenv from 'dotenv';
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { EventBus } from '../../../eventBus/eventBus.js';
import { z, ZodObject } from 'zod';
import { Prompt } from './prompt.js';
import { getEventBus } from '../../../eventBus/index.js';
import { BadRequestError } from 'openai';
import { CustomBot } from '../../types.js';
import { StructuredTool } from '@langchain/core/tools';
import { Vec3 } from 'vec3';
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
            default:
              zodType = z.string();
          }

          // デフォルト値があれば設定
          if (param.default !== undefined) {
            // anyでキャストして型の互換性問題を回避
            zodType = (zodType as any).default(param.default);
          }

          // null許容を追加
          zodType = zodType.nullable();

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
    console.log(`\x1b[32m%s\x1b[0m`, `${skill.skillName}を実行します。パラメータ：${JSON.stringify(data)}`);

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

// forceStop/humanFeedbackPending監視用Promise
function waitForStop(state: any) {
  return new Promise((_, reject) => {
    // 最大待機時間（ミリ秒）
    const maxWaitTime = 10000; // 10秒
    let elapsedTime = 0;

    const interval = setInterval(() => {
      // 強制停止または人間フィードバック要求の場合
      if (state.forceStop || state.humanFeedbackPending) {
        clearInterval(interval);
        console.log('waitForStop', state.forceStop, state.humanFeedbackPending);
        reject(new Error('強制終了または人間フィードバック要求で中断'));
        return;
      }

      // 経過時間を増加
      elapsedTime += 100;

      // 最大待機時間を超えた場合
      if (elapsedTime >= maxWaitTime) {
        clearInterval(interval);
        reject(new Error('waitForStop関数がタイムアウトしました'));
      }
    }, 100);
  });
}

export class TaskGraph {
  private static instance: TaskGraph;
  private largeModel: ChatOpenAI | null = null;
  private mediumModel: ChatOpenAI | null = null;
  private smallModel: ChatOpenAI | null = null;
  private tools: any[] = [];
  private toolNodeInstance: ToolNode;
  private graph: any;
  private eventBus: EventBus;
  private prompt: Prompt;
  private isRunning: boolean = true;
  private waitSeconds: number | null = null;
  private bot: CustomBot;
  public currentState: any = null;
  constructor(bot: CustomBot) {
    this.bot = bot;
    this.eventBus = getEventBus();
    this.initializeModel();
    this.initializeTools();
    this.toolNodeInstance = new ToolNode(this.tools);
    this.graph = this.createGraph();
    this.initializeEventBus();
    this.prompt = new Prompt(this.tools);
  }

  public static getInstance(bot: CustomBot): TaskGraph {
    if (!TaskGraph.instance) {
      TaskGraph.instance = new TaskGraph(bot);
    }
    return TaskGraph.instance;
  }
  private async initializeEventBus() {
    this.eventBus.subscribe('task:stop', (event) => {
      console.log(`タスクを停止します`);
      this.isRunning = false;
      const { waitSeconds } = event.data as TaskInput;
      if (waitSeconds) {
        this.waitSeconds = waitSeconds;
      }
    });
    this.eventBus.subscribe('task:start', () => {
      console.log(`タスクを再開します`);
      this.isRunning = true;
      this.waitSeconds = null;
    });
  }
  private async initializeModel() {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set');
    }

    const SmallModel = new ChatOpenAI({
      modelName: 'gpt-4o-mini',
      temperature: 1,
      apiKey: OPENAI_API_KEY,
    });
    const MediumModel = new ChatOpenAI({
      modelName: 'gpt-4o',
      temperature: 0.8,
      apiKey: OPENAI_API_KEY,
    });
    const LargeModel = new ChatOpenAI({
      modelName: 'o4-mini',
      apiKey: OPENAI_API_KEY,
      useResponsesApi: true,
    });

    this.largeModel = LargeModel;
    this.mediumModel = MediumModel;
    this.smallModel = SmallModel;
  }
  public async initializeTools() {
    // instantSkillsから全スキルを取得
    const skills = this.bot.instantSkills.getSkills();
    for (const skill of skills) {
      if (!skill.isToolForLLM) continue;
      const skillTool = new InstantSkillTool(skill, this.bot);
      console.log('skillToolName', skillTool.name);
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
  private errorHandler = async (
    state: typeof this.TaskState.State,
    error: Error
  ) => {
    if (error instanceof BadRequestError) {
      console.log(
        '\x1b[31mAn assistant message with "tool_calls" must be followed by tool messages responding to each "tool_call_id".\x1b[0m'
      );
      return {
        taskTree: {
          status: 'error',
          ...state.taskTree,
        } as TaskTreeState,
      };
    }
    return {
      taskTree: {
        status: 'error',
        ...state.taskTree,
      } as TaskTreeState,
    };
  };

  private toolAgentNode = async (state: typeof this.TaskState.State) => {
    console.log('toolAgentNode');
    const messages = this.prompt.getMessages(state, 'use_tool', false);
    if (!this.mediumModel) {
      throw new Error('Medium model not initialized');
    }
    const llmWithTools = this.mediumModel.bindTools(this.tools);
    const forcedToolLLM = llmWithTools.bind({
      tool_choice: 'any',
    });
    try {
      // 中断条件をチェックしてから処理を開始
      if (state.forceStop || state.humanFeedbackPending) {
        console.log('toolAgentNode: 既に中断条件が満たされています');
        throw new Error('強制終了または人間フィードバック要求で中断');
      }

      const result = await Promise.race([
        forcedToolLLM.invoke(messages),
        waitForStop(state),
      ]);
      if (state.forceStop) {
        // 強制終了フラグが立っていたら何も返さず終了
        return {
          taskTree: {
            status: 'error',
            goal: '強制終了されました',
            strategy: '',
            subTasks: null,
          },
        };
      }
      return { messages: [result] };
    } catch (error) {
      console.error('toolAgentNode error:', error);
      return this.errorHandler(state, error as Error);
    }
  };

  private planningNode = async (state: typeof this.TaskState.State) => {
    // humanFeedbackPendingをリセット
    const hadFeedback = state.humanFeedbackPending;
    this.currentState.humanFeedbackPending = false;
    state.humanFeedbackPending = false;
    state.humanFeedback = this.currentState.humanFeedback;
    state.environmentState = JSON.stringify(this.bot.environmentState);
    state.selfState = JSON.stringify(this.bot.selfState);

    if (!this.mediumModel) {
      throw new Error('Medium model not initialized');
    }

    // 人間フィードバックがあった場合はメッセージに追加
    if (hadFeedback && state.humanFeedback) {
      console.log(
        'planningNode: 人間フィードバックを処理します:',
        state.humanFeedback
      );
    }

    const PlanningSchema = z.object({
      status: z.enum(['pending', 'in_progress', 'completed', 'error']),
      goal: z.string(),
      strategy: z.string(),
      subTasks: z
        .array(
          z.object({
            subTaskStatus: z.enum([
              'pending',
              'in_progress',
              'completed',
              'error',
            ]),
            subTaskGoal: z.string(),
            subTaskStrategy: z.string(),
            subTaskResult: z.string().nullable(),
          })
        )
        .nullable(),
    });
    const structuredLLM = this.mediumModel.withStructuredOutput(
      PlanningSchema,
      {
        name: 'Planning',
      }
    );
    const messages = this.prompt.getMessages(state, 'planning', true);

    try {
      const response = await structuredLLM.invoke(messages);
      console.log('planning response:', response);
      return {
        taskTree: {
          status: response.status,
          goal: response.goal,
          strategy: response.strategy,
          subTasks: response.subTasks,
        } as TaskTreeState,
      };
    } catch (error) {
      console.error('planningNode error:', error);
      return this.errorHandler(state, error as Error);
    }
  };

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
    forceStop: Annotation<boolean>({
      reducer: (_, next) => next,
      default: () => false,
    }),
  });

  private createGraph() {
    const workflow = new StateGraph(this.TaskState)
      .addNode('planning', this.planningNode)
      .addNode('tool_agent', this.toolAgentNode)
      .addNode('use_tool', this.toolNodeInstance)
      .addEdge(START, 'planning')
      .addConditionalEdges('planning', (state) => {
        if (this.currentState.forceStop) {
          return END;
        }
        if (this.currentState.humanFeedbackPending) {
          this.currentState.humanFeedbackPending = false;
          return 'planning';
        }
        if (
          state.taskTree?.status === 'completed' ||
          state.taskTree?.status === 'error'
        ) {
          console.log('\x1b[31mtaskTree completed\x1b[0m');
          return END;
        } else {
          return 'tool_agent';
        }
      })
      .addConditionalEdges('tool_agent', (state) => {
        // humanFeedbackPendingがtrueならplanningに強制遷移
        if (this.currentState.forceStop) {
          return END;
        }
        const lastMessage = state.messages[state.messages.length - 1];
        if (
          lastMessage instanceof AIMessage &&
          Array.isArray(lastMessage.tool_calls) &&
          lastMessage.tool_calls.length > 0
        ) {
          return 'use_tool';
        } else {
          return END;
        }
      })
      .addConditionalEdges('use_tool', (state) => {
        // humanFeedbackPendingがtrueならplanningに強制遷移
        if (this.currentState.forceStop) {
          return END;
        }
        if (this.currentState.humanFeedbackPending) {
          this.currentState.humanFeedbackPending = false;
          return 'planning';
        }
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
    };
    this.currentState = state;

    try {
      console.log('タスクグラフ実行開始 ID:', state.taskId);
      const result = await this.graph.invoke(state, { recursionLimit: 64 });
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
}

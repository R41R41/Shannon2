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

    try {
      // スキルのパラメータ定義を取得
      const params = skill.params || [];
      const args = params.map((param) => {
        if (param.type === 'Vec3') {
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

export class TaskGraph {
  private static instance: TaskGraph;
  private largeModel: ChatOpenAI | null = null;
  private mediumModel: ChatOpenAI | null = null;
  private smallModel: ChatOpenAI | null = null;
  private tools: any[] = [];
  private toolNode: ToolNode;
  private graph: any;
  private eventBus: EventBus;
  private prompt: Prompt;
  private isRunning: boolean = true;
  private waitSeconds: number | null = null;
  private bot: CustomBot;
  constructor(bot: CustomBot) {
    this.bot = bot;
    this.eventBus = getEventBus();
    this.initializeModel();
    this.initializeTools();
    this.toolNode = new ToolNode(this.tools);
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
      const response = await forcedToolLLM.invoke(messages);
      console.log('toolAgentNode response:', response);
      return {
        messages: [response],
      };
    } catch (error) {
      console.error('toolAgentNode error:', error);
      return this.errorHandler(state, error as Error);
    }
  };

  private planningNode = async (state: typeof this.TaskState.State) => {
    console.log('planning', state.messages);
    if (!this.mediumModel) {
      throw new Error('Medium model not initialized');
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
    selfFeedback: Annotation<string | null>({
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
  });

  private createGraph() {
    const workflow = new StateGraph(this.TaskState)
      .addNode('planning', this.planningNode)
      .addNode('tool_agent', this.toolAgentNode)
      .addNode('use_tool', this.toolNode)
      .addEdge(START, 'planning')
      .addConditionalEdges('planning', (state) => {
        if (
          state.taskTree?.status === 'completed' ||
          state.taskTree?.status === 'error'
        ) {
          console.log('taskTree completed');
          return END;
        } else {
          return 'tool_agent';
        }
      })
      .addConditionalEdges('tool_agent', (state) => {
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
        return 'planning';
      });
    return workflow.compile();
  }

  public async invoke(partialState: TaskStateInput) {
    let state: typeof this.TaskState.State = {
      taskId: crypto.randomUUID(),
      environmentState: partialState.environmentState ?? null,
      selfState: partialState.selfState ?? null,
      humanFeedback: null,
      selfFeedback: null,
      messages: partialState.messages ?? [],
      userMessage: partialState.userMessage ?? null,
      taskTree: null,
    };

    try {
      return await this.graph.invoke(state, { recursionLimit: 64 });
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
      throw error;
    }
  }
}

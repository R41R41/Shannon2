import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { ChatOpenAI } from '@langchain/openai';
import {
  MemoryZone,
  EmotionType,
  TaskInput,
  TaskTreeState,
} from '@shannon/common';
import { TaskStateInput } from './types.js';
import dotenv from 'dotenv';
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { EventBus } from '../../eventBus/eventBus.js';
import { z } from 'zod';
import { Prompt } from './prompt.js';
import { getEventBus } from '../../eventBus/index.js';
import { BadRequestError } from 'openai';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

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
  constructor() {
    this.eventBus = getEventBus();
    this.initializeModel();
    this.initializeTools();
    this.toolNode = new ToolNode(this.tools);
    this.graph = this.createGraph();
    this.initializeEventBus();
    this.prompt = new Prompt(this.tools);
  }

  public static getInstance(): TaskGraph {
    if (!TaskGraph.instance) {
      TaskGraph.instance = new TaskGraph();
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
      modelName: 'gpt-3.5-turbo',
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
      temperature: 0.8,
      apiKey: OPENAI_API_KEY,
    });

    this.largeModel = LargeModel;
    this.mediumModel = MediumModel;
    this.smallModel = SmallModel;
  }

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
    const messages = this.prompt.getMessages(state, 'use_tool', true, false);
    if (!this.mediumModel) {
      throw new Error('Medium model not initialized');
    }
    const llmWithTools = this.mediumModel.bindTools(this.tools);
    const forcedToolLLM = llmWithTools.bind({
      tool_choice: 'any',
    });
    try {
      // console.log('messages', JSON.stringify(messages, null, 2));
      const response = await forcedToolLLM.invoke(messages);
      // console.log('\x1b[35muse_tool', response, '\x1b[0m');
      return {
        messages: [response],
      };
    } catch (error) {
      return this.errorHandler(state, error as Error);
    }
  };

  private planningNode = async (state: typeof this.TaskState.State) => {
    console.log('planning');
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
            subTaskResult: z.string().nullable(),
          })
        )
        .nullable(),
    });
    const structuredLLM = this.mediumModel.withStructuredOutput(PlanningSchema, {
      name: 'Planning',
    });
    const messages = this.prompt.getMessages(state, 'planning', true, true);

    try {
      // console.log('planning', JSON.stringify(messages, null, 2));
      const response = await structuredLLM.invoke(messages);
      if (this.eventBus) {
        console.log('eventBus publish');
        this.eventBus.publish({
          type: 'web:planning',
          memoryZone: 'web',
          data: response,
          targetMemoryZones: ['web'],
        });
        if (state.channelId) {
          this.eventBus.publish({
            type: 'discord:planning',
            memoryZone: state.memoryZone,
            data: {
              planning: response,
              channelId: state.channelId,
              taskId: state.taskId,
            },
          });
        }
      }
      console.log('planning', JSON.stringify(response, null, 2));
      return {
        taskTree: {
          status: response.status,
          goal: response.goal,
          strategy: response.strategy,
          subTasks: response.subTasks,
        } as TaskTreeState,
      };
    } catch (error) {
      return this.errorHandler(state, error as Error);
    }
  };

  private emotionNode = async (state: typeof this.TaskState.State) => {
    console.log('emotionNode');
    const messages = this.prompt.getMessages(state, 'emotion', true);

    if (!this.mediumModel) {
      throw new Error('Medium model not initialized');
    }
    const EmotionSchema = z.object({
      emotion: z.string(),
      parameters: z.object({
        joy: z.number(),
        trust: z.number(),
        fear: z.number(),
        surprise: z.number(),
        sadness: z.number(),
        disgust: z.number(),
        anger: z.number(),
        anticipation: z.number(),
      }),
    });
    const structuredLLM = this.mediumModel.withStructuredOutput(EmotionSchema, {
      name: 'Emotion',
    });
    try {
      // console.log('emotionNode', JSON.stringify(messages, null, 2));
      const response = await structuredLLM.invoke(messages);
      // console.log('\x1b[35memotion', response, '\x1b[0m');
      if (this.eventBus) {
        this.eventBus.publish({
          type: 'web:emotion',
          memoryZone: 'web',
          data: response,
          targetMemoryZones: ['web'],
        });
      }
      return {
        emotion: {
          emotion: response.emotion,
          parameters: response.parameters,
        },
      };
    } catch (error: any) {
      return this.errorHandler(state, error as Error);
    }
  };

  private TaskState = Annotation.Root({
    taskId: Annotation<string>({
      reducer: (_, next) => next,
      default: () => '',
    }),
    memoryZone: Annotation<MemoryZone>({
      reducer: (_, next) => next,
      default: () => 'web',
    }),
    channelId: Annotation<string | null>({
      reducer: (_, next) => next,
      default: () => null,
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
    emotion: Annotation<EmotionType | null>({
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
      .addNode('feel_emotion', this.emotionNode)
      .addNode('tool_agent', this.toolAgentNode)
      .addNode('use_tool', this.toolNode)
      .addEdge(START, 'feel_emotion')
      .addEdge('feel_emotion', 'planning')
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
        if (
          state.messages[state.messages.length - 1].additional_kwargs.tool_calls
        ) {
          return 'use_tool';
        } else {
          return END;
        }
      })
      .addConditionalEdges('use_tool', (state) => {
        // this.baseMessagesToLog(state.messages, state.memoryZone);
        return 'feel_emotion';
      });
    return workflow.compile();
  }

  public async invoke(partialState: TaskStateInput) {
    let state: typeof this.TaskState.State = {
      taskId: crypto.randomUUID(),
      memoryZone: partialState.memoryZone ?? 'web',
      channelId: partialState.channelId ?? null,
      environmentState: partialState.environmentState ?? null,
      selfState: partialState.selfState ?? null,
      humanFeedback: null,
      selfFeedback: null,
      messages: partialState.messages ?? [],
      userMessage: partialState.userMessage ?? null,
      emotion: partialState.emotion ?? null,
      taskTree: {
        status: 'in_progress',
        goal: '',
        strategy: '',
        subTasks: null,
      },
    };

    try {
      // 再帰制限を大幅に増やす
      return await this.graph.invoke(state, { recursionLimit: 32 });
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

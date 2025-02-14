import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { ChatOpenAI } from '@langchain/openai';
import { MemoryZone, PromptType, EmotionType } from '@shannon/common';
import dotenv from 'dotenv';
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { EventBus } from '../../eventBus/eventBus.js';
import { loadPrompt } from '../config/prompts.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'error';
type NextAction = 'use_tool' | 'make_message' | 'plan' | 'feel_emotion';

interface TaskTreeState {
  goal: string;
  plan: string;
  status: TaskStatus;
  error?: string;
  subTasks: TaskTreeState[];
}

interface TaskStateInput {
  memoryZone?: MemoryZone;
  systemPrompt?: string;
  infoMessage?: string | null;
  emotion?: EmotionType | null;
  taskTree?: TaskTreeState | null;
  nextAction?: NextAction | null;
  messages?: BaseMessage[];
  responseMessage?: string | null;
}

export class TaskGraph {
  private largeModel: ChatOpenAI | null = null;
  private mediumModel: ChatOpenAI | null = null;
  private smallModel: ChatOpenAI | null = null;
  private tools: any[] = [];
  private toolNode: ToolNode;
  private graph: any;
  private eventBus: EventBus | null = null;
  private systemPrompts: Map<PromptType, string>;
  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus ?? null;
    this.initializeModel();
    this.initializeTools();
    this.toolNode = new ToolNode(this.tools);
    this.graph = this.createGraph();
    this.systemPrompts = new Map();
    this.setupSystemPrompts();
  }

  private getPrompt = (
    state: typeof this.TaskState.State,
    prompt: string | null = null,
    isInfoMessage: boolean = false,
    isEmotion: boolean = false,
    isTaskTree: boolean = false,
    isCurrentTime: boolean = false,
    isSystemPrompt: boolean = false,
    isMemoryZone: boolean = false
  ) => {
    const currentTime = new Date().toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
    });

    const infoMessage =
      isInfoMessage && state.infoMessage
        ? `infoMessage: ${JSON.stringify(state.infoMessage, null, 2)
            .replace(/\\n/g, '\n')
            .replace(/\\/g, '')}`
        : null;

    const currentTimeMessage = isCurrentTime
      ? `currentTime: ${currentTime}`
      : '';
    const memoryZoneMessage = isMemoryZone
      ? `memoryZone: ${state.memoryZone}`
      : '';

    const messages = [
      prompt ? new SystemMessage(prompt) : null,
      isSystemPrompt && state.systemPrompt
        ? new SystemMessage(state.systemPrompt)
        : null,
      ...state.messages.slice(-16),
      state.responseMessage
        ? new SystemMessage(`ResponseMessage: ${state.responseMessage}`)
        : null,
      isEmotion && state.emotion
        ? new SystemMessage(`yourEmotion: ${JSON.stringify(state.emotion)}`)
        : null,
      isTaskTree && state.taskTree
        ? new SystemMessage(
            `goal: ${state.taskTree.goal}\nplan: ${
              state.taskTree.plan
            }\nsubTasks: ${JSON.stringify(state.taskTree.subTasks)}`
          )
        : null,
      infoMessage || currentTimeMessage || memoryZoneMessage
        ? new SystemMessage(
            [infoMessage, currentTimeMessage, memoryZoneMessage]
              .filter(Boolean)
              .join('\n')
          )
        : null,
    ].filter((message): message is BaseMessage => message !== null);

    return messages;
  };

  private async setupSystemPrompts(): Promise<void> {
    const promptsName: PromptType[] = [
      'planning',
      'decision',
      'base_text',
      'discord',
      'emotion',
      'think_next_action',
      'make_response_message',
      'use_tool',
    ];
    for (const name of promptsName) {
      this.systemPrompts.set(name, await loadPrompt(name));
    }
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
      modelName: 'gpt-4o-mini',
      temperature: 0.8,
      apiKey: OPENAI_API_KEY,
    });
    const LargeModel = new ChatOpenAI({
      modelName: 'gpt-4o',
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
  }

  private baseMessagesToLog(messages: BaseMessage[], memoryZone: MemoryZone) {
    console.log('-------------------------------');
    for (const message of messages) {
      try {
        if (message instanceof HumanMessage) {
          console.log(`\x1b[37m${message.content}\x1b[0m`);
        } else if (message instanceof AIMessage) {
          if (message.additional_kwargs.tool_calls) {
            console.log(
              `\x1b[32m${message.additional_kwargs.tool_calls[0].function.name}\x1b[0m`
            );
            if (this.eventBus) {
              this.eventBus.log(
                memoryZone,
                'green',
                message.additional_kwargs.tool_calls[0].function.name,
                true
              );
            }
            console.log(
              `\x1b[32m${message.additional_kwargs.tool_calls[0].function.arguments}\x1b[0m`
            );
            if (this.eventBus) {
              this.eventBus.log(
                memoryZone,
                'green',
                message.additional_kwargs.tool_calls[0].function.arguments,
                true
              );
            }
          } else {
            console.log(`\x1b[32mShannon: ${message.content}\x1b[0m`);
          }
        } else if (message instanceof SystemMessage) {
          console.log(`\x1b[37m${message.content}\x1b[0m`);
        } else if (message instanceof ToolMessage) {
          console.log(`\x1b[34m${message.content}\x1b[0m`);
          if (this.eventBus) {
            this.eventBus.log(
              memoryZone,
              'blue',
              message.content.toString(),
              true
            );
          }
        }
      } catch (error) {
        console.error('ログ出力エラー:', error);
      }
    }
    console.log('-------------------------------');
  }

  private errorHandler = async (state: typeof this.TaskState.State) => {
    return {
      ...state.taskTree,
      status: 'error',
      error: '処理中にエラーが発生しました',
    } as TaskTreeState;
  };

  private toolAgentNode = async (state: typeof this.TaskState.State) => {
    console.log('toolAgentNode');
    const systemPrompt = this.systemPrompts.get('use_tool');
    if (!systemPrompt) {
      throw new Error('use_tool prompt not found');
    }
    const messages = this.getPrompt(
      state,
      systemPrompt,
      true,
      true,
      true,
      true,
      true,
      true
    );
    if (!this.largeModel) {
      throw new Error('Large model not initialized');
    }
    const modelWithTools = this.largeModel.bindTools(this.tools);
    try {
      const response = await modelWithTools.invoke(messages);
      console.log('\x1b[35muse_tool', response, '\x1b[0m');
      return {
        messages: [response],
      };
    } catch (error) {
      console.error('JSONパースエラー:', error);
      return this.errorHandler(state);
    }
  };

  private planningNode = async (state: typeof this.TaskState.State) => {
    console.log('planningNode');
    const planningPrompt = this.systemPrompts.get('planning');
    if (!planningPrompt) {
      throw new Error('Planning prompt not found');
    }
    const messages = this.getPrompt(
      state,
      planningPrompt,
      true,
      true,
      true,
      true,
      false,
      false
    );
    if (!this.mediumModel) {
      throw new Error('Medium model not initialized');
    }
    const parser = new JsonOutputParser();
    const chain = this.mediumModel.pipe(parser);

    try {
      const response = await chain.invoke(messages);
      return {
        ...state.taskTree,
        goal: response.goal,
        plan: response.plan,
        subTasks: response.subTasks,
      } as TaskTreeState;
    } catch (error) {
      console.error('JSONパースエラー:', error);
      return this.errorHandler(state);
    }
  };

  private thinkingNextNode = async (state: typeof this.TaskState.State) => {
    console.log('thinkingNextNode');
    const thinkNextPrompt = this.systemPrompts.get('think_next_action');
    if (!thinkNextPrompt) {
      throw new Error('Think next prompt not found');
    }
    if (!this.largeModel) {
      throw new Error('Large model not initialized');
    }
    const messages = this.getPrompt(
      state,
      thinkNextPrompt,
      true,
      true,
      true,
      true,
      false,
      false
    );

    const parser = new JsonOutputParser();
    const chain = this.largeModel.pipe(parser);

    try {
      console.log('think_next_action', messages);
      const response = await chain.invoke(messages);
      console.log('\x1b[35mthink_next_action', response.nextAction, '\x1b[0m');
      return { nextAction: response.nextAction };
    } catch (error) {
      console.error('JSONパースエラー:', error);
      return this.errorHandler(state);
    }
  };

  private responseNode = async (state: typeof this.TaskState.State) => {
    console.log('responseNode');
    const responsePrompt = this.systemPrompts.get('make_response_message');
    if (!responsePrompt) {
      throw new Error('Response prompt not found');
    }
    const messages = this.getPrompt(
      state,
      responsePrompt,
      true,
      true,
      true,
      true,
      false,
      false
    );
    if (!this.mediumModel) {
      throw new Error('Medium model not initialized');
    }
    const parser = new JsonOutputParser();
    const chain = this.mediumModel?.pipe(parser);
    try {
      const response = await chain.invoke(messages);
      console.log(
        '\x1b[35mmake_response_message',
        response.responseMessage,
        '\x1b[0m'
      );
      return {
        responseMessage: response.responseMessage,
        messages: [new AIMessage(response.responseMessage)],
      };
    } catch (error) {
      console.error('JSONパースエラー:', error);
      return this.errorHandler(state);
    }
  };

  private emotionNode = async (state: typeof this.TaskState.State) => {
    console.log('emotionNode');
    const emotionPrompt = this.systemPrompts.get('emotion');
    if (!emotionPrompt) {
      throw new Error('Emotion prompt not found');
    }
    const messages = this.getPrompt(
      state,
      emotionPrompt,
      false,
      true,
      false,
      false,
      false,
      false
    );

    if (!this.mediumModel) {
      throw new Error('Medium model not initialized');
    }
    const parser = new JsonOutputParser();
    const chain = this.mediumModel?.pipe(parser);
    try {
      const response = await chain.invoke(messages);
      console.log('\x1b[35memotion', response, '\x1b[0m');
      return {
        emotion: response,
      };
    } catch (error) {
      console.error('JSONパースエラー:', error);
      return this.errorHandler(state);
    }
  };

  private TaskState = Annotation.Root({
    memoryZone: Annotation<MemoryZone>({
      reducer: (_, next) => next,
      default: () => 'web',
    }),
    systemPrompt: Annotation<string>({
      reducer: (_, next) => next,
      default: () => '',
    }),
    infoMessage: Annotation<string | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
    messages: Annotation<BaseMessage[]>({
      reducer: (prev, next) => prev.concat(next),
      default: () => [],
    }),
    emotion: Annotation<EmotionType | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
    taskTree: Annotation<TaskTreeState | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
    nextAction: Annotation<NextAction | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
    responseMessage: Annotation<string | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
  });

  private createGraph() {
    const workflow = new StateGraph(this.TaskState)
      .addNode('think_next_action', this.thinkingNextNode)
      .addNode('plan', this.planningNode)
      .addNode('agent', this.toolAgentNode)
      .addNode('use_tool', this.toolNode)
      .addNode('make_message', this.responseNode)
      .addNode('feel_emotion', this.emotionNode)
      .addConditionalEdges('agent', (state) => {
        const lastMessage = state.messages[
          state.messages.length - 1
        ] as AIMessage;
        return lastMessage.tool_calls?.length
          ? 'use_tool'
          : 'think_next_action';
      })
      .addEdge(START, 'think_next_action')
      .addConditionalEdges('plan', (state) => {
        return 'think_next_action';
      })
      .addConditionalEdges('think_next_action', (state) => {
        switch (state.nextAction) {
          case 'use_tool':
            return 'agent';
          case 'make_message':
            return 'make_message';
          case 'plan':
            return 'plan';
          case 'feel_emotion':
            return 'feel_emotion';
          default:
            return END;
        }
      })
      .addEdge('use_tool', 'think_next_action')
      .addEdge('make_message', 'think_next_action')
      .addEdge('plan', 'think_next_action')
      .addEdge('feel_emotion', 'think_next_action');

    return workflow.compile();
  }

  public async invoke(partialState: TaskStateInput) {
    // デフォルト値とマージ
    let state: typeof this.TaskState.State = {
      memoryZone: partialState.memoryZone ?? 'web',
      systemPrompt: partialState.systemPrompt ?? '',
      infoMessage: partialState.infoMessage ?? null,
      messages: partialState.messages ?? [],
      emotion: partialState.emotion ?? null,
      taskTree: partialState.taskTree ?? null,
      nextAction: partialState.nextAction ?? null,
      responseMessage: partialState.responseMessage ?? null,
    };
    return await this.graph.invoke(state);
  }
}

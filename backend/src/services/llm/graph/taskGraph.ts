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
import { MemoryZone, EmotionType } from '@shannon/common';
import { TaskTreeState, TaskStateInput, NextAction } from './types.js';
import dotenv from 'dotenv';
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { EventBus } from '../../eventBus/eventBus.js';
import { z } from 'zod';
import { Prompt } from './prompt.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

export class TaskGraph {
  private largeModel: ChatOpenAI | null = null;
  private mediumModel: ChatOpenAI | null = null;
  private smallModel: ChatOpenAI | null = null;
  private tools: any[] = [];
  private toolNode: ToolNode;
  private graph: any;
  private eventBus: EventBus | null = null;
  private prompt: Prompt;
  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus ?? null;
    this.initializeModel();
    this.initializeTools();
    this.toolNode = new ToolNode(this.tools);
    this.graph = this.createGraph();
    this.prompt = new Prompt();
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
    const messages = this.prompt.getMessages(state, 'use_tool', true);
    if (!this.largeModel) {
      throw new Error('Large model not initialized');
    }
    const llmWithTools = this.largeModel.bindTools(this.tools);
    const forcedToolLLM = llmWithTools.bind({
      tool_choice: 'any',
    });
    try {
      const response = await forcedToolLLM.invoke(messages);
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
    console.log('planning');
    if (!this.mediumModel) {
      throw new Error('Medium model not initialized');
    }
    const llmWithTools = this.mediumModel.bindTools(this.tools);
    const forcedToolLLM = llmWithTools.bind({
      tool_choice: { type: 'function', function: { name: 'planning' } },
    });
    const messages = this.prompt.getMessages(state, 'planning', true);

    try {
      const response = await forcedToolLLM.invoke(messages);
      const toolCall = response.additional_kwargs.tool_calls?.[0];
      if (!toolCall) throw new Error('No tool call found');
      const result = JSON.parse(toolCall.function.arguments);

      return {
        taskTree: {
          status: result.status,
          goal: result.goal,
          plan: result.plan,
          subTasks: result.subTasks,
        } as TaskTreeState,
        nextAction: result.nextAction,
      };
    } catch (error) {
      console.error('JSONパースエラー:', error);
      return this.errorHandler(state);
    }
  };

  private makeMessageNode = async (state: typeof this.TaskState.State) => {
    console.log('makeMessageNode');
    const messages = this.prompt.getMessages(state, 'make_message', true);
    if (!this.mediumModel) {
      throw new Error('Medium model not initialized');
    }
    const ResponseMessageSchema = z.object({
      responseMessage: z.string(),
    });
    const structuredLLM = this.mediumModel.withStructuredOutput(
      ResponseMessageSchema,
      {
        name: 'ResponseMessage',
      }
    );

    try {
      const response = await structuredLLM.invoke(messages);
      console.log('\x1b[35mmake_message', response, '\x1b[0m');
      return {
        responseMessage: response.responseMessage,
        messages: [new AIMessage(response.responseMessage)],
      };
    } catch (error) {
      console.error('JSONパースエラー:', error);
      return this.errorHandler(state);
    }
  };

  private sendMessageNode = async (state: typeof this.TaskState.State) => {
    console.log('sendMessageNode');
    const messages = this.prompt.getMessages(state, 'send_message', true);
    if (!this.mediumModel) {
      throw new Error('Medium model not initialized');
    }
    const llmWithTools = this.mediumModel.bindTools(this.tools);
    const forcedToolLLM = llmWithTools.bind({
      tool_choice: { type: 'function', function: { name: 'chat-on-discord' } },
    });
    try {
      const response = await forcedToolLLM.invoke(messages);
      console.log('\x1b[35msend_message', response, '\x1b[0m');
      return {
        messages: [response],
      };
    } catch (error) {
      console.error('JSONパースエラー:', error);
      return this.errorHandler(state);
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
      const response = await structuredLLM.invoke(messages);
      console.log('\x1b[35memotion', response, '\x1b[0m');
      return {
        emotion: {
          emotion: response.emotion,
          parameters: response.parameters,
        },
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
      .addNode('planning', this.planningNode)
      .addNode('feel_emotion', this.emotionNode)
      .addNode('tool_agent', this.toolAgentNode)
      .addNode('use_tool', this.toolNode)
      .addNode('make_message', this.makeMessageNode)
      .addNode('send_message', this.sendMessageNode)
      .addEdge('tool_agent', 'use_tool')
      .addConditionalEdges('use_tool', (state) => {
        this.baseMessagesToLog(state.messages, state.memoryZone);
        return 'planning';
      })
      .addEdge('feel_emotion', 'make_message')
      .addEdge('make_message', 'send_message')
      .addEdge('send_message', 'use_tool')
      .addEdge(START, 'planning')
      .addConditionalEdges('planning', (state) => {
        switch (state.nextAction) {
          case 'use_tool':
            return 'tool_agent';
          case 'make_and_send_message':
            return 'feel_emotion';
          case 'END':
            return END;
          default:
            return END;
        }
      });

    return workflow.compile();
  }

  public async invoke(partialState: TaskStateInput) {
    // デフォルト値とマージ
    let state: typeof this.TaskState.State = {
      memoryZone: partialState.memoryZone ?? 'web',
      environmentState: partialState.environmentState ?? null,
      selfState: partialState.selfState ?? null,
      humanFeedback: partialState.humanFeedback ?? null,
      selfFeedback: partialState.selfFeedback ?? null,
      messages: partialState.messages ?? [],
      emotion: partialState.emotion ?? null,
      taskTree: partialState.taskTree ?? null,
      nextAction: partialState.nextAction ?? null,
      responseMessage: partialState.responseMessage ?? null,
    };
    return await this.graph.invoke(state);
  }
}

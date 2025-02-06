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
import { MemoryZone, PromptType } from '@shannon/common';
import dotenv from 'dotenv';
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { EventBus } from '../../eventBus.js';
import { loadPrompt } from '../config/prompts.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'error';

interface TaskTreeState {
  goal: string;
  plan: string;
  status: TaskStatus;
  error?: string;
  subTasks: TaskTreeState[];
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

  private async setupSystemPrompts(): Promise<void> {
    const promptsName: PromptType[] = ['planning', 'decision'];
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

  private callModel = async (state: typeof this.TaskState.State) => {
    console.log('\x1b[31mcallModel\x1b[0m');
    const taskTree = await this.planning(state);
    console.log('\x1b[31mtaskTree', taskTree, '\x1b[0m');
    const response = await this.callToolModel(state, taskTree);
    console.log('\x1b[31mresponse', response, '\x1b[0m');
    return {
      taskTree,
      messages: [response],
    };
  };

  private summarizeConversation = async (
    state: typeof this.TaskState.State
  ): Promise<typeof this.TaskState.State> => {
    if (!this.smallModel) {
      throw new Error('Small model not initialized');
    }
    const summary = await this.smallModel.invoke([
      new SystemMessage('これまでの会話を簡潔に要約してください。'),
      ...state.conversationHistory.messages,
    ]);

    return {
      ...state,
      conversationHistory: {
        messages: state.conversationHistory.messages.slice(-10),
        summary: summary.content.toString(),
      },
    };
  };

  private errorHandler = async (state: typeof this.TaskState.State) => {
    return {
      ...state.taskTree,
      status: 'error',
      error: '処理中にエラーが発生しました',
    } as TaskTreeState;
  };

  private decisionNode = async (state: typeof this.TaskState.State) => {
    const decisionPrompt = this.systemPrompts.get('decision');
    if (!decisionPrompt) {
      throw new Error('Decision prompt not found');
    }

    if (!this.smallModel) {
      throw new Error('Small model not initialized');
    }

    const parser = new JsonOutputParser();
    const chain = this.smallModel.pipe(parser);

    const currentTime = new Date().toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
    });
    const chatSummary = state.conversationHistory.summary;

    const messages = [
      new SystemMessage(decisionPrompt),
      new SystemMessage(`currentTime: ${currentTime}`),
      state.infoMessage ? new SystemMessage(state.infoMessage) : null,
      chatSummary ? new SystemMessage(`chatSummary: ${chatSummary}`) : null,
      ...state.conversationHistory.messages.slice(-10),
    ].filter((message): message is BaseMessage => message !== null);

    try {
      const response = await chain.invoke(messages);
      return { decision: response.decision };
    } catch (error) {
      console.error('JSONパースエラー:', error);
      return this.errorHandler(state);
    }
  };

  private planning = async (
    state: typeof this.TaskState.State
  ): Promise<TaskTreeState> => {
    const planningPrompt = this.systemPrompts.get('planning');
    if (!planningPrompt) {
      throw new Error('Planning prompt not found');
    }

    const currentTime = new Date().toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
    });
    const chatSummary = state.conversationHistory.summary;

    const messages = [
      new SystemMessage(planningPrompt),
      new SystemMessage(`currentTime: ${currentTime}`),
      state.infoMessage ? new SystemMessage(state.infoMessage) : null,
      chatSummary ? new SystemMessage(`chatSummary: ${chatSummary}`) : null,
      ...state.conversationHistory.messages.slice(-10),
      new SystemMessage(`goal: ${state.taskTree.goal}`),
      new SystemMessage(`plan: ${state.taskTree.plan}`),
      new SystemMessage(`subTasks: ${JSON.stringify(state.taskTree.subTasks)}`),
      new SystemMessage(`yourAction: ${JSON.stringify(state.messages)}`),
    ].filter((message): message is BaseMessage => message !== null);

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
  private callToolModel = async (
    state: typeof this.TaskState.State,
    taskTree: TaskTreeState
  ) => {
    const modelWithTools = this.largeModel?.bindTools(this.tools);
    if (!modelWithTools) {
      throw new Error('Model or tools not initialized');
    }
    const currentTime = new Date().toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
    });
    const chatSummary = state.conversationHistory.summary;
    const goal = taskTree.goal;
    const plan = taskTree.plan;
    const subTasks = taskTree.subTasks;
    const messages = [
      new SystemMessage(state.systemPrompt),
      new SystemMessage(`currentTime: ${currentTime}`),
      state.infoMessage ? new SystemMessage(state.infoMessage) : null,
      chatSummary ? new SystemMessage(`chatSummary: ${chatSummary}`) : null,
      ...state.conversationHistory.messages.slice(-10),
      ...state.messages.filter(
        (message): message is AIMessage | ToolMessage =>
          message instanceof AIMessage || message instanceof ToolMessage
      ),
      goal ? new AIMessage(`goal: ${goal}`) : null,
      plan ? new AIMessage(`plan: ${plan}`) : null,
      subTasks.length > 0
        ? new AIMessage(`subTasks: ${JSON.stringify(subTasks)}`)
        : null,
    ].filter((message): message is BaseMessage => message !== null);

    this.baseMessagesToLog(messages, state.memoryZone);
    const response = await modelWithTools.invoke(messages);
    this.baseMessagesToLog([response], state.memoryZone);
    return response;
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
    taskTree: Annotation<TaskTreeState>({
      reducer: (_, next) => next,
      default: () => ({
        goal: '',
        plan: '',
        status: 'pending',
        subTasks: [],
      }),
    }),
    conversationHistory: Annotation<{
      messages: BaseMessage[];
      summary?: string | null;
    }>({
      reducer: (prev, next) => ({
        messages: [...prev.messages, ...next.messages],
        summary: next.summary || prev.summary,
      }),
      default: () => ({
        messages: [],
        summary: null,
      }),
    }),
    decision: Annotation<string | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
  });

  private createGraph() {
    const workflow = new StateGraph(this.TaskState)
      .addNode('decision_maker', this.decisionNode)
      .addNode('agent', this.callModel)
      .addNode('tools', this.toolNode)
      .addEdge(START, 'decision_maker')
      .addConditionalEdges('decision_maker', (state) => {
        return state.decision === 'respond' ? 'agent' : END;
      })
      .addConditionalEdges('agent', (state) => {
        const lastMessage = state.messages[
          state.messages.length - 1
        ] as AIMessage;
        return lastMessage.tool_calls?.length ? 'tools' : END;
      })
      .addEdge('tools', 'agent');

    return workflow.compile();
  }

  public async invoke(state: typeof this.TaskState.State) {
    if (state.conversationHistory.messages.length > 10) {
      state = await this.summarizeConversation(state);
    }
    return await this.graph.invoke(state);
  }
}

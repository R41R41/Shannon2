import { ChatOpenAI } from '@langchain/openai';
import { StateGraph, START, END } from '@langchain/langgraph';
import { Annotation } from '@langchain/langgraph';
import {
  BaseMessage,
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { EventBus } from '../../eventBus.js';
import { Platform } from '../types/index.js';
import dotenv from 'dotenv';
import { readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'error';

interface TaskTreeState {
  goal: string;
  status: TaskStatus;
  error?: string;
  children: TaskTreeState[];
}

export class TaskGraph {
  private model: ChatOpenAI | null = null;
  private tools: any[] = [];
  private toolNode: ToolNode;
  private graph: any;
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.initializeModel();
    this.initializeTools();
    this.toolNode = new ToolNode(this.tools);
    this.graph = this.createGraph();
  }

  private async initializeModel() {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set');
    }

    const model = new ChatOpenAI({
      modelName: 'gpt-4o',
      temperature: 0.8,
      apiKey: OPENAI_API_KEY,
    });

    this.model = model;
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

  private baseMessagesToLog(messages: BaseMessage[], platform: Platform) {
    for (const message of messages) {
      if (message instanceof HumanMessage) {
        console.log(`\x1b[37m${message.content}\x1b[0m`);
      } else if (message instanceof AIMessage) {
        if (message.additional_kwargs.tool_calls) {
          console.log(
            `\x1b[32m${message.additional_kwargs.tool_calls[0].function.name}\x1b[0m`
          );
          this.eventBus.log(
            platform,
            'green',
            message.additional_kwargs.tool_calls[0].function.name,
            true
          );
          console.log(
            `\x1b[32m${message.additional_kwargs.tool_calls[0].function.arguments}\x1b[0m`
          );
          this.eventBus.log(
            platform,
            'green',
            message.additional_kwargs.tool_calls[0].function.arguments,
            true
          );
        } else {
          console.log(`\x1b[32mShannon: ${message.content}\x1b[0m`);
        }
      } else if (message instanceof SystemMessage) {
        console.log(`\x1b[37m${message.content}\x1b[0m`);
      } else if (message instanceof ToolMessage) {
        console.log(`\x1b[34m${message.content}\x1b[0m`);
        this.eventBus.log(platform, 'blue', message.content.toString(), true);
      }
    }
  }

  private callModel = async (state: typeof this.TaskState.State) => {
    const modelWithTools = this.model?.bindTools(this.tools);
    if (!modelWithTools) {
      throw new Error('Model or tools not initialized');
    }
    const currentTime = new Date().toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
    });
    let messages: BaseMessage[] = [];
    if (state.conversationHistory.summary) {
      messages = [
        new SystemMessage(state.systemPrompt),
        new SystemMessage(`currentTime: ${currentTime}`),
        new SystemMessage(state.infoMessage),
        new SystemMessage(`chatSummary: ${state.conversationHistory.summary}`),
        ...state.conversationHistory.messages.slice(-10),
        ...state.messages,
      ];
    } else {
      messages = [
        new SystemMessage(state.systemPrompt),
        new SystemMessage(`current time: ${currentTime}`),
        new SystemMessage(state.infoMessage),
        ...state.conversationHistory.messages.slice(-10),
        ...state.messages,
      ];
    }
    this.baseMessagesToLog(messages, state.platform);
    const response = await modelWithTools.invoke(messages);
    this.baseMessagesToLog([response], state.platform);
    return { messages: [response] };
  };

  private async summarizeConversation(state: typeof this.TaskState.State) {
    const model = new ChatOpenAI({ modelName: 'gpt-3.5-turbo' });

    const summary = await model.invoke([
      new SystemMessage('これまでの会話を簡潔に要約してください。'),
      ...state.conversationHistory.messages,
    ]);

    return {
      conversationHistory: {
        messages: state.conversationHistory.messages,
        summary: summary.content,
      },
    };
  }

  private errorHandler = async (state: typeof this.TaskState.State) => {
    return {
      taskTree: {
        ...state.taskTree,
        status: 'error',
        error: '処理中にエラーが発生しました',
      },
    };
  };

  private TaskState = Annotation.Root({
    platform: Annotation<Platform>({
      reducer: (_, next) => next,
      default: () => 'discord',
    }),
    systemPrompt: Annotation<string>({
      reducer: (_, next) => next,
      default: () => '',
    }),
    infoMessage: Annotation<string>({
      reducer: (_, next) => next,
      default: () => '',
    }),
    messages: Annotation<BaseMessage[]>({
      reducer: (prev, next) => prev.concat(next),
      default: () => [],
    }),
    taskTree: Annotation<TaskTreeState>({
      reducer: (_, next) => next,
      default: () => ({
        goal: '',
        status: 'pending',
        children: [],
      }),
    }),
    conversationHistory: Annotation<{
      messages: BaseMessage[];
      summary?: string;
    }>({
      reducer: (prev, next) => ({
        messages: [...prev.messages, ...next.messages],
        summary: next.summary || prev.summary,
      }),
      default: () => ({
        messages: [],
        summary: '',
      }),
    }),
  });

  private createGraph() {
    const workflow = new StateGraph(this.TaskState)
      .addNode('agent', this.callModel)
      .addNode('tools', this.toolNode)
      .addNode('error_handler', this.errorHandler)
      .addNode('summarize', this.summarizeConversation)
      .addEdge(START, 'agent')
      .addConditionalEdges('agent', (state) => {
        const { messages } = state;
        const lastMessage = messages[messages.length - 1] as AIMessage;

        if ('tool_calls' in lastMessage && lastMessage.tool_calls?.length) {
          return 'tools';
        }
        if (state.taskTree.status === 'error') {
          return 'error_handler';
        }
        if (
          !state.conversationHistory.summary &&
          state.conversationHistory.messages.length >= 30
        ) {
          return 'summarize';
        }
        return END;
      })
      .addEdge('tools', 'agent')
      .addEdge('summarize', 'agent');

    return workflow.compile();
  }

  async invoke(state: typeof this.TaskState.State) {
    return await this.graph.invoke(state);
  }
}

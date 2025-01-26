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
import { BingSearchTool, SearchWeatherTool } from '../tools/index.js';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { EventBus } from '../../eventBus.js';
import dotenv from 'dotenv';

dotenv.config();

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'error';

interface TaskTreeState {
  goal: string;
  status: TaskStatus;
  error?: string;
  children: TaskTreeState[];
}

export class TaskGraph {
  private model: ChatOpenAI;
  private tools: any[];
  private toolNode: ToolNode;
  private graph: any;
  private eventBus: EventBus;
  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.model = this.initializeModel();
    this.tools = this.initializeTools();
    this.toolNode = this.initializeToolNode();
    this.graph = this.createGraph();
  }

  private initializeModel() {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set');
    }

    const model = new ChatOpenAI({
      modelName: 'gpt-4o',
      temperature: 0.8,
      apiKey: OPENAI_API_KEY,
    });

    return model;
  }

  private initializeTools() {
    const tools = [new BingSearchTool(), new SearchWeatherTool()];
    return tools;
  }

  private initializeToolNode() {
    const toolNode = new ToolNode(this.tools);
    return toolNode;
  }

  private baseMessagesToLog(messages: BaseMessage[]) {
    for (const message of messages) {
      if (message instanceof HumanMessage) {
        console.log(`\x1b[37m${message.content}\x1b[0m`);
      } else if (message instanceof AIMessage) {
        if (message.additional_kwargs.tool_calls) {
          console.log(
            `\x1b[32m${message.additional_kwargs.tool_calls[0].function.name}\x1b[0m`
          );
          this.eventBus.log(
            'discord',
            'green',
            message.additional_kwargs.tool_calls[0].function.name
          );
          console.log(
            `\x1b[32m${message.additional_kwargs.tool_calls[0].function.arguments}\x1b[0m`
          );
          this.eventBus.log(
            'discord',
            'green',
            message.additional_kwargs.tool_calls[0].function.arguments
          );
        } else {
          console.log(`\x1b[32mShannon: ${message.content}\x1b[0m`);
        }
      } else if (message instanceof SystemMessage) {
        console.log(`\x1b[37m${message.content}\x1b[0m`);
      } else if (message instanceof ToolMessage) {
        console.log(`\x1b[34m${message.content}\x1b[0m`);
        this.eventBus.log('discord', 'blue', message.content.toString());
      }
    }
  }

  private callModel = async (state: typeof this.TaskState.State) => {
    const modelWithTools = this.model.bindTools(this.tools);
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
    this.baseMessagesToLog(messages);
    const response = await modelWithTools.invoke(messages);
    this.baseMessagesToLog([response]);
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

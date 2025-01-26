import { ChatOpenAI } from '@langchain/openai';
import { RunnableSequence } from '@langchain/core/runnables';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { Platform } from '../types/index.js';
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
import dotenv from 'dotenv';

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'error';

interface TaskTreeState {
  goal: string;
  status: TaskStatus;
  error?: string;
  children: TaskTreeState[];
}

const TaskState = Annotation.Root({
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
  currentTask: Annotation<string>({
    reducer: (_, next) => next,
    default: () => '',
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

const model = new ChatOpenAI({
  modelName: 'gpt-4o',
  temperature: 0.8,
  apiKey: OPENAI_API_KEY,
});
const tools = [new BingSearchTool(), new SearchWeatherTool()];
const toolNode = new ToolNode(tools);

const callModel = async (state: typeof TaskState.State) => {
  const modelWithTools = model.bindTools(tools);
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
  baseMessagesToLog(messages);
  const response = await modelWithTools.invoke(messages);
  baseMessagesToLog([response]);
  return { messages: [response] };
};

const errorHandler = async (state: typeof TaskState.State) => {
  return {
    taskTree: {
      ...state.taskTree,
      status: 'error',
      error: '処理中にエラーが発生しました',
    },
  };
};

const summarizeConversation = async (state: typeof TaskState.State) => {
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
};

const workflow = new StateGraph(TaskState)
  .addNode('agent', callModel)
  .addNode('tools', toolNode)
  .addNode('error_handler', errorHandler)
  .addNode('summarize', summarizeConversation)
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

const graph = workflow.compile();

export function createTaskGraph() {
  return graph;
}

const baseMessagesToLog = (messages: BaseMessage[]) => {
  for (const message of messages) {
    if (message instanceof HumanMessage) {
      console.log(`\x1b[37m${message.content}\x1b[0m`);
    } else if (message instanceof AIMessage) {
      if (message.additional_kwargs.tool_calls) {
        console.log(
          `\x1b[32m${message.additional_kwargs.tool_calls[0].function.name}\x1b[0m`
        );
        console.log(
          `\x1b[32m${message.additional_kwargs.tool_calls[0].function.arguments}\x1b[0m`
        );
      } else {
        console.log(`\x1b[32mShannon: ${message.content}\x1b[0m`);
      }
    } else if (message instanceof SystemMessage) {
      console.log(`\x1b[37m${message.content}\x1b[0m`);
    } else if (message instanceof ToolMessage) {
      console.log(`\x1b[34m${message.content}\x1b[0m`);
    }
  }
};

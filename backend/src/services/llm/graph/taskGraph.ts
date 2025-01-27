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
  plan: string;
  status: TaskStatus;
  error?: string;
  subTasks: TaskTreeState[];
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
    const chatSummary = state.conversationHistory.summary;
    const goal = state.taskTree.goal;
    const plan = state.taskTree.plan;
    const subTasks = state.taskTree.subTasks;
    const messages = [
      new SystemMessage(state.systemPrompt),
      new SystemMessage(`currentTime: ${currentTime}`),
      new SystemMessage(state.infoMessage),
      chatSummary ? new SystemMessage(`chatSummary: ${chatSummary}`) : null,
      ...state.conversationHistory.messages.slice(-10),
      ...state.messages,
      goal ? new AIMessage(`goal: ${goal}`) : null,
      plan ? new AIMessage(`plan: ${plan}`) : null,
      subTasks.length > 0
        ? new AIMessage(`subTasks: ${JSON.stringify(subTasks)}`)
        : null,
    ].filter((message): message is BaseMessage => message !== null);

    console.log(messages);

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

  private decisionNode = async (state: typeof this.TaskState.State) => {
    const decisionPrompt = `
    以下のメッセージを分析し、すぐに回答可能か計画が必要か判定してください：
    # 判定基準
    - 日常会話や単純な質問 → immediate
    - 調査/計算/複数ステップが必要 → plan
    `;

    if (!this.model) {
      throw new Error('Model not initialized');
    }

    const currentTime = new Date().toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
    });
    const chatSummary = state.conversationHistory.summary;

    const messages = [
      new SystemMessage(decisionPrompt),
      new HumanMessage('判定結果（immediate/plan）のみを回答してください'),
      new SystemMessage(`currentTime: ${currentTime}`),
      new SystemMessage(state.infoMessage),
      chatSummary ? new SystemMessage(`chatSummary: ${chatSummary}`) : null,
      ...state.conversationHistory.messages.slice(-10),
    ].filter((message): message is BaseMessage => message !== null);

    const decision = await this.model.invoke(messages);

    console.log(decision.content.toString());

    return { decision: decision.content.toString().trim().toLowerCase() };
  };

  private planningNode = async (state: typeof this.TaskState.State) => {
    const planningPrompt = `文脈を理解し、ユーザーに回答するために以下の形式で計画を立案してください：
    {
      "goal": "達成すべき最終目標",
      "plan": "全体の戦略",
      "subTasks": [
        {"goal": "サブタスク1", "plan": "サブタスク1の計画"},
        {"goal": "サブタスク2", "plan": "サブタスク2の計画"}
      ]
    }
    `;

    const currentTime = new Date().toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
    });
    const chatSummary = state.conversationHistory.summary;

    const messages = [
      new SystemMessage(planningPrompt),
      new SystemMessage(`currentTime: ${currentTime}`),
      new SystemMessage(state.infoMessage),
      chatSummary ? new SystemMessage(`chatSummary: ${chatSummary}`) : null,
      ...state.conversationHistory.messages.slice(-10),
    ].filter((message): message is BaseMessage => message !== null);

    if (!this.model) {
      throw new Error('Model not initialized');
    }

    console.log(messages);

    const plan = await this.model.invoke(messages);
    return {
      taskTree: {
        ...state.taskTree,
        goal: JSON.parse(plan.content.toString()).goal,
        plan: JSON.parse(plan.content.toString()).plan,
        subTasks: JSON.parse(plan.content.toString()).subTasks,
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
        plan: '',
        status: 'pending',
        subTasks: [],
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
    decision: Annotation<string>({
      reducer: (_, next) => next,
      default: () => '',
    }),
  });

  private createGraph() {
    const workflow = new StateGraph(this.TaskState)
      .addNode('decision_maker', this.decisionNode)
      .addNode('agent', this.callModel)
      .addNode('planning', this.planningNode)
      .addNode('tools', this.toolNode)
      .addEdge(START, 'decision_maker')
      .addConditionalEdges('decision_maker', (state) => {
        return state.decision === 'immediate' ? 'agent' : 'planning';
      })
      .addEdge('planning', 'agent')
      .addConditionalEdges('agent', (state) => {
        const lastMessage = state.messages[
          state.messages.length - 1
        ] as AIMessage;
        return lastMessage.tool_calls?.length ? 'tools' : END;
      })
      .addEdge('tools', 'agent');

    return workflow.compile();
  }

  async invoke(state: typeof this.TaskState.State) {
    return await this.graph.invoke(state);
  }
}

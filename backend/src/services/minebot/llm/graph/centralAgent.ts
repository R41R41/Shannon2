import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { CustomBot } from '../../types.js';
import { TaskGraph } from './taskGraph.js';

type TaskAction = 'new_task' | 'feedback' | 'stop';

export class CentralAgent {
  private static instance: CentralAgent;
  private bot: CustomBot;
  public currentTaskGraph: TaskGraph | null = null;
  private openai: ChatOpenAI;

  private constructor(bot: CustomBot) {
    this.bot = bot;
    // gpt-4.1-miniを使用（最新の軽量モデル、2025-11-30更新）
    // gpt-4o-miniより性能向上（$0.40/$1.60 per 1M tokens）
    this.openai = new ChatOpenAI({
      modelName: 'gpt-4.1-mini',
      apiKey: process.env.OPENAI_API_KEY!,
      temperature: 0.3, // 判定は確実性を重視
    });
    console.log('🤖 CentralAgent initialized with gpt-4.1-mini');
  }

  public static getInstance(bot: CustomBot) {
    if (!CentralAgent.instance) {
      CentralAgent.instance = new CentralAgent(bot);
    }
    return CentralAgent.instance;
  }

  public async initialize() {
    this.currentTaskGraph = TaskGraph.getInstance();
    console.log('initialize');
    if (this.currentTaskGraph) {
      console.log('initializeTaskGraph');
      await this.currentTaskGraph.initialize(this.bot);
    }
  }

  // プレイヤー発言を処理
  public async handlePlayerMessage(
    userName: string,
    message: string,
    environmentState?: string,
    selfState?: string,
    recentMessages?: BaseMessage[]
  ) {
    let action: TaskAction = 'new_task';
    if (this.currentTaskGraph?.currentState) {
      const currentState = this.currentTaskGraph.currentState;
      if (
        currentState.taskTree.status &&
        currentState.taskTree.status === 'in_progress'
      ) {
        console.log('judgeAction');
        action = await this.judgeAction(message, recentMessages || []);
      }
    }

    if (action === 'new_task') {
      console.log('\x1b[31m新しいタスクを作成します\x1b[0m');
      // 既存タスクがあれば強制終了
      if (this.currentTaskGraph?.currentState) {
        const currentState = this.currentTaskGraph.currentState;
        if (currentState.taskTree.status) {
          console.log('\x1b[31m既存タスクを強制終了します\x1b[0m');
          this.currentTaskGraph.forceStop();
        }
      }
      // 新しいタスクを作成
      if (!this.currentTaskGraph) {
        this.currentTaskGraph = TaskGraph.getInstance();
        await this.currentTaskGraph.initialize(this.bot);
      }
      try {
        this.currentTaskGraph.invoke({
          messages: recentMessages,
          userMessage: message,
          environmentState: environmentState,
          selfState: selfState,
        });
      } catch (error) {
        console.error(`\x1b[31mLLM処理エラー:${error}\n\x1b[0m`);
        throw error;
      }
    } else if (action === 'feedback' && this.currentTaskGraph) {
      // humanFeedbackを更新
      console.log('\x1b[31mフィードバックを更新します\x1b[0m');
      this.currentTaskGraph.updateHumanFeedback(message);
    } else if (action === 'stop' && this.currentTaskGraph) {
      // タスクを終了
      console.log('\x1b[31mタスクを終了します\x1b[0m');
      this.currentTaskGraph.forceStop();
    }
  }

  // OpenAIでアクション判定（軽量モデルで高速判定）
  private async judgeAction(
    message: string,
    recentMessages: BaseMessage[]
  ): Promise<TaskAction> {
    const systemPrompt1 = `プレイヤーの発言が新しいタスクの依頼か、既存タスクへのアドバイスか、タスク終了要望かを判定し、"new_task" "feedback" "stop"のいずれかで返答してください。`;
    const systemPrompt2 = `実行中のタスク: ${JSON.stringify(
      this.currentTaskGraph?.currentState?.taskTree
    )}`;

    console.log('🔍 CentralAgent: アクションを判定中...');
    const res = await this.openai.invoke([
      new SystemMessage(systemPrompt1),
      new SystemMessage(systemPrompt2),
      ...recentMessages.slice(-5), // 最新5件のみ使用してコスト削減
      new HumanMessage(message),
    ]);
    // contentがstring型であることを保証
    const text =
      typeof res.content === 'string'
        ? res.content.trim()
        : Array.isArray(res.content)
        ? res.content
            .map((c: any) => (typeof c === 'string' ? c : c.text))
            .join(' ')
            .trim()
        : '';

    console.log('✅ アクション判定完了:', text);
    if (text.includes('new_task')) return 'new_task';
    if (text.includes('feedback')) return 'feedback';
    if (text.includes('stop')) return 'stop';
    // デフォルトはnew_task
    return 'new_task';
  }
}

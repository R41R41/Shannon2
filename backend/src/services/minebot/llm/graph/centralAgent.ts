import { CustomBot } from '../../types.js';
import { TaskGraph } from './taskGraph.js';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

type TaskAction = 'new_task' | 'feedback' | 'stop';

export class CentralAgent {
  private static instance: CentralAgent;
  private bot: CustomBot;
  private currentTaskGraph: TaskGraph | null = null;
  private openai: ChatOpenAI;

  private constructor(bot: CustomBot) {
    this.bot = bot;
    this.openai = new ChatOpenAI({
      modelName: 'gpt-4o-mini',
      apiKey: process.env.OPENAI_API_KEY!,
    });
    this.currentTaskGraph = TaskGraph.getInstance(this.bot);
  }

  public static getInstance(bot: CustomBot) {
    if (!CentralAgent.instance) {
      CentralAgent.instance = new CentralAgent(bot);
    }
    return CentralAgent.instance;
  }

  public async initialize() {
    if (this.currentTaskGraph) {
      await this.currentTaskGraph.initializeTools();
    }
  }

  // プレイヤー発言を処理
  public async handlePlayerMessage(
    userName: string,
    message: string,
    environmentState?: string,
    selfState?: string
  ) {
    let action: TaskAction = 'new_task';
    if (this.currentTaskGraph?.currentState) {
      const currentState = this.currentTaskGraph.currentState;
      if (currentState.taskTree.status) {
        action = await this.judgeAction(message);
      }
    }

    if (action === 'new_task') {
      // 既存タスクがあれば強制終了
      if (this.currentTaskGraph?.currentState) {
        const currentState = this.currentTaskGraph.currentState;
        if (currentState.taskTree.status) {
          this.currentTaskGraph.forceStop();
        }
      }
      // 新しいタスクを作成
      if (!this.currentTaskGraph) {
        this.currentTaskGraph = TaskGraph.getInstance(this.bot);
      }
      try {
        this.currentTaskGraph.invoke({
          messages: [new HumanMessage(message)],
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
      this.currentTaskGraph.updateHumanFeedback(message);
    } else if (action === 'stop' && this.currentTaskGraph) {
      // タスクを終了
      console.log('\x1b[31mタスクを終了します\x1b[0m');
      this.currentTaskGraph.forceStop();
    }
  }

  // OpenAIでアクション判定
  private async judgeAction(message: string): Promise<TaskAction> {
    const systemPrompt = `プレイヤーの発言が新しいタスクの依頼か、既存タスクへのアドバイスか、タスク終了要望かを判定し、"new_task" "feedback" "stop"のいずれかで返答してください。`;
    const res = await this.openai.invoke([
      new SystemMessage(systemPrompt),
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
    if (text.includes('new_task')) return 'new_task';
    if (text.includes('feedback')) return 'feedback';
    if (text.includes('stop')) return 'stop';
    // デフォルトはnew_task
    return 'new_task';
  }
}

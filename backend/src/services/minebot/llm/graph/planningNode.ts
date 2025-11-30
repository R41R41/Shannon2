import { ChatOpenAI } from '@langchain/openai';
import { TaskTreeState } from '@shannon/common';
import { z } from 'zod';
import { Prompt } from './prompt.js';

// taskTreeをPOST送信する関数
async function sendTaskTreeToServer(taskTree: any) {
  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch('http://localhost:8081/task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(taskTree),
    });
    if (!response.ok) {
      console.error(
        'taskTree送信失敗:',
        response.status,
        await response.text()
      );
    } else {
      console.log('taskTree送信成功');
    }
  } catch (error) {
    console.error('taskTree送信エラー:', error);
  }
}

/**
 * Planning Node: 戦略立案とタスク計画
 * 使用モデル: o1-mini (推論能力が高い)
 */
export class PlanningNode {
  private model: ChatOpenAI;
  private prompt: Prompt;
  private bot: any;

  constructor(bot: any, prompt: Prompt) {
    this.bot = bot;
    this.prompt = prompt;

    // o3-miniを使用（最新の推論特化モデル、2025-11-30更新）
    // o1-miniより推論品質向上、コスト削減（$1.10/$4.40 per 1M tokens）
    this.model = new ChatOpenAI({
      modelName: 'o3-mini',
      apiKey: process.env.OPENAI_API_KEY!,
      temperature: 1,
    });
  }

  async invoke(state: any): Promise<any> {
    console.log('🧠 PlanningNode: 戦略を立案中...');

    // humanFeedbackPendingをリセット
    const hadFeedback = state.humanFeedbackPending;
    state.humanFeedbackPending = false;

    // 状態を更新
    const autoUpdateState =
      this.bot.constantSkills.getSkill('auto-update-state');
    if (autoUpdateState) {
      await autoUpdateState.run();
    }
    state.selfState = JSON.stringify(this.bot.selfState);
    state.environmentState = JSON.stringify(this.bot.environmentState);

    // 人間フィードバックがあった場合はメッセージに追加
    if (hadFeedback && state.humanFeedback) {
      console.log('📝 人間フィードバックを処理:', state.humanFeedback);
    }

    // Planning用のスキーマ定義
    const PlanningSchema = z.object({
      status: z.enum(['pending', 'in_progress', 'completed', 'error']),
      goal: z.string(),
      strategy: z.string(),
      // 原子的アクションのシーケンス
      actionSequence: z
        .array(
          z.object({
            toolName: z.string().describe('実行するツール名'),
            args: z.record(z.string(), z.unknown()).describe('ツールの引数'),
            expectedResult: z
              .string()
              .describe('このアクションで期待される結果'),
          })
        )
        .nullable()
        .describe(
          '一度に実行する原子的アクションのシーケンス。順番に実行され、エラーが発生したら即座に中断してplanningに戻ります。'
        ),
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

    const structuredLLM = this.model.withStructuredOutput(PlanningSchema, {
      name: 'Planning',
    });

    const messages = this.prompt.getMessages(state, 'planning', true);

    try {
      const response = await structuredLLM.invoke(messages);
      console.log('✅ Planning完了:', {
        goal: response.goal.substring(0, 50),
        actionCount: response.actionSequence?.length || 0,
        subTaskCount: response.subTasks?.length || 0,
      });

      // taskTreeを送信
      await sendTaskTreeToServer({
        status: response.status,
        goal: response.goal,
        strategy: response.strategy,
        actionSequence: response.actionSequence,
        subTasks: response.subTasks,
      });

      return {
        taskTree: {
          status: response.status,
          goal: response.goal,
          strategy: response.strategy,
          actionSequence: response.actionSequence,
          subTasks: response.subTasks,
        } as TaskTreeState,
      };
    } catch (error) {
      console.error('❌ PlanningNode error:', error);
      return {
        taskTree: {
          status: 'error',
          goal: `エラー: ${error instanceof Error ? error.message : '不明なエラー'
            }`,
          strategy: '',
          actionSequence: null,
          subTasks: null,
        } as TaskTreeState,
      };
    }
  }
}

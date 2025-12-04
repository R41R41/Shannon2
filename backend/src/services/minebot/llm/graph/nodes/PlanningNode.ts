import { ChatOpenAI } from '@langchain/openai';
import { TaskTreeState } from '@shannon/common';
import { z } from 'zod';
import { CentralLogManager, LogManager } from '../logging/index.js';
import { Prompt } from '../prompt.js';

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
  private logManager: LogManager;
  private centralLogManager: CentralLogManager;
  private onEmergencyResolved: (() => Promise<void>) | null = null;

  constructor(bot: any, prompt: Prompt, centralLogManager?: CentralLogManager) {
    this.bot = bot;
    this.prompt = prompt;
    this.centralLogManager = centralLogManager || CentralLogManager.getInstance();
    this.logManager = this.centralLogManager.getLogManager('planning_node');

    // gpt-4o-miniを使用（高速 & Structured Outputs対応）
    this.model = new ChatOpenAI({
      modelName: 'gpt-4o',
      apiKey: process.env.OPENAI_API_KEY!,
      temperature: 0.7,
    });
  }

  /**
   * 緊急状態解除ハンドラーを設定
   */
  public setEmergencyResolvedHandler(handler: () => Promise<void>): void {
    this.onEmergencyResolved = handler;
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
    state.environmentState = JSON.stringify(this.bot.environmentState);

    // 詳細なボット状態を botStatus に統一（selfState は廃止）
    const entity = this.bot.entity as any;
    const health = this.bot.health || 0;
    const food = this.bot.food || 0;

    state.botStatus = {
      position: entity?.position || { x: 0, y: 0, z: 0 },
      health,
      maxHealth: 20,
      healthPercent: ((health / 20) * 100).toFixed(0) + '%',
      healthStatus: health < 8 ? '危険' : health < 14 ? '注意' : '良好',
      food,
      maxFood: 20,
      foodPercent: ((food / 20) * 100).toFixed(0) + '%',
      foodStatus: food < 6 ? '飢餓' : food < 12 ? '空腹' : '満腹',
      inventory: this.bot.inventory.items().map((item: any) => ({
        name: item.name,
        count: item.count,
      })).slice(0, 10), // 最初の10アイテムのみ
      inventoryUsed: this.bot.inventory.items().length,
      inventoryTotal: 36,
      equipment: {
        hand: this.bot.inventory.slots[this.bot.quickBarSlot]?.name || 'なし',
        offHand: this.bot.inventory.slots[45]?.name || 'なし',
        head: this.bot.inventory.slots[5]?.name || 'なし',
        chest: this.bot.inventory.slots[6]?.name || 'なし',
        legs: this.bot.inventory.slots[7]?.name || 'なし',
        feet: this.bot.inventory.slots[8]?.name || 'なし',
      },
      conditions: {
        isInWater: entity?.isInWater || false,
        isInLava: entity?.isInLava || false,
        isOnGround: entity?.onGround || false,
        isCollidedVertically: entity?.isCollidedVertically || false,
      },
    };

    // 人間フィードバックがあった場合はメッセージに追加
    if (hadFeedback && state.humanFeedback) {
      console.log('📝 人間フィードバックを処理:', state.humanFeedback);
    }

    // Planning用のスキーマ定義
    const PlanningSchema = z.object({
      status: z.enum(['pending', 'in_progress', 'completed', 'error']),
      goal: z.string(),
      strategy: z.string(),
      emergencyResolved: z.boolean().nullable().describe(
        '緊急事態が解決された場合はtrueを返す。HPが回復した、安全な場所に移動した、窒息から脱出したなど。緊急事態でない場合はnull。'
      ),
      // 原子的アクションのシーケンス
      actionSequence: z
        .array(
          z.object({
            toolName: z.string().describe('実行するツール名'),
            args: z.string().describe(
              'MUST BE VALID JSON STRING with DOUBLE QUOTES ONLY. ' +
              'NEVER use single quotes or Python syntax (True/False/None). ' +
              'Example: \'{"blockName": "oak_log", "maxDistance": 50, "count": 3}\''
            ),
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
      // Planning開始ログ
      this.logManager.addLog({
        phase: 'planning',
        level: 'info',
        source: 'planning_node',
        content: '🤔 Thinking... (Planning in progress)',
        metadata: {
          status: 'loading',
        },
      });

      const response = await structuredLLM.invoke(messages);

      // 詳細なプランニング結果をログ出力
      console.log('\x1b[36m═══════════════════════════════════════════════════════════════\x1b[0m');
      console.log('\x1b[36m📋 Planning結果\x1b[0m');
      console.log('\x1b[36m═══════════════════════════════════════════════════════════════\x1b[0m');
      console.log(`\x1b[33m🎯 Goal:\x1b[0m ${response.goal}`);
      console.log(`\x1b[33m📝 Strategy:\x1b[0m ${response.strategy}`);
      console.log(`\x1b[33m📊 Status:\x1b[0m ${response.status}`);
      if (response.emergencyResolved !== null && response.emergencyResolved !== undefined) {
        console.log(`\x1b[33m🚨 EmergencyResolved:\x1b[0m ${response.emergencyResolved}`);
      }

      if (response.actionSequence && response.actionSequence.length > 0) {
        console.log(`\x1b[32m⚡ ActionSequence (${response.actionSequence.length}個):\x1b[0m`);
        response.actionSequence.forEach((action, i) => {
          console.log(`   ${i + 1}. \x1b[35m${action.toolName}\x1b[0m`);
          console.log(`      args: ${action.args}`);
          console.log(`      期待: ${action.expectedResult}`);
        });
      } else {
        console.log('\x1b[33m⚡ ActionSequence: なし\x1b[0m');
      }

      if (response.subTasks && response.subTasks.length > 0) {
        console.log(`\x1b[32m📌 SubTasks (${response.subTasks.length}個):\x1b[0m`);
        response.subTasks.forEach((task, i) => {
          console.log(`   ${i + 1}. [${task.subTaskStatus}] ${task.subTaskGoal}`);
        });
      }
      console.log('\x1b[36m═══════════════════════════════════════════════════════════════\x1b[0m');

      // ログに記録（詳細なTaskTree情報を含める）
      this.logManager.addLog({
        phase: 'planning',
        level: 'success',
        source: 'planning_node',
        content: `Plan created: ${response.goal}`,
        metadata: {
          goal: response.goal,
          strategy: response.strategy,
          status: response.status,
          emergencyResolved: response.emergencyResolved,
          actionSequence: response.actionSequence,
          subTasks: response.subTasks,
          actionCount: response.actionSequence?.length || 0,
          subTaskCount: response.subTasks?.length || 0,
        },
      });

      // taskTreeを送信（actionSequenceは除外）
      await sendTaskTreeToServer({
        status: response.status,
        goal: response.goal,
        strategy: response.strategy,
        subTasks: response.subTasks,
      });

      // 緊急状態が解決されたかチェック
      if (response.emergencyResolved && state.isEmergency) {
        console.log('\x1b[32m✅ LLMが緊急状態の解決を確認しました\x1b[0m');
        if (this.onEmergencyResolved) {
          await this.onEmergencyResolved();
        }
      }

      return {
        taskTree: {
          status: response.status,
          goal: response.goal,
          strategy: response.strategy,
          actionSequence: response.actionSequence,
          subTasks: response.subTasks,
        } as TaskTreeState,
        isEmergency: state.isEmergency, // 緊急フラグを保持
      };
    } catch (error) {
      console.error('❌ PlanningNode error:', error);

      // ログに記録
      this.logManager.addLog({
        phase: 'planning',
        level: 'error',
        source: 'planning_node',
        content: `Planning failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        },
      });

      // エラー時もtaskTreeを送信（actionSequenceは除外）
      await sendTaskTreeToServer({
        status: 'error',
        goal: `エラー: ${error instanceof Error ? error.message : '不明なエラー'}`,
        strategy: '',
        subTasks: null,
      });

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

  getLogs() {
    return this.logManager.getLogs();
  }

  clearLogs() {
    this.logManager.clearLogs();
  }
}

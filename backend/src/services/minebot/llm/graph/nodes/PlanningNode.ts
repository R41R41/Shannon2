import { ChatOpenAI } from '@langchain/openai';
import { HierarchicalSubTask, TaskTreeState } from '@shannon/common';
import { z } from 'zod';
import { CentralLogManager, LogManager } from '../logging/index.js';
import { Prompt } from '../prompt.js';

// 失敗したサブタスクの情報
interface FailedSubTaskInfo {
  subTaskId: string;
  goal: string;
  failureReason: string;
  executedActions?: string[];
}

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

  // 階層的サブタスクの状態
  private hierarchicalSubTasks: HierarchicalSubTask[] = [];
  private currentSubTaskId: string | null = null;
  private subTaskIdCounter: number = 0;

  constructor(bot: any, prompt: Prompt, centralLogManager?: CentralLogManager) {
    this.bot = bot;
    this.prompt = prompt;
    this.centralLogManager = centralLogManager || CentralLogManager.getInstance();
    this.logManager = this.centralLogManager.getLogManager('planning_node');

    // gpt-4oを使用（高速 & Structured Outputs対応）
    this.model = new ChatOpenAI({
      modelName: 'gpt-4o',
      apiKey: process.env.OPENAI_API_KEY!,
      temperature: 0.7,
    });
  }

  /**
   * ユニークなサブタスクIDを生成
   */
  private generateSubTaskId(): string {
    return `st_${++this.subTaskIdCounter}`;
  }

  /**
   * 失敗したサブタスクを分解する
   */
  async decomposeFailedSubTask(failedInfo: FailedSubTaskInfo): Promise<HierarchicalSubTask[]> {
    console.log(`\x1b[33m🔧 サブタスク「${failedInfo.goal}」を分解中...\x1b[0m`);
    console.log(`   失敗理由: ${failedInfo.failureReason}`);

    const DecomposeSchema = z.object({
      newSubTasks: z.array(
        z.object({
          goal: z.string().describe('サブタスクの目標'),
          strategy: z.string().describe('達成するための戦略'),
          actionSequence: z.array(
            z.object({
              toolName: z.string(),
              args: z.string().nullable(),
              expectedResult: z.string(),
            })
          ).nullable().describe('このサブタスクで実行するアクション（シンプルな場合のみ）'),
        })
      ).describe('分解された新しいサブタスク'),
      decompositionReason: z.string().describe('なぜこのように分解したか'),
    });

    const structuredLLM = this.model.withStructuredOutput(DecomposeSchema, {
      name: 'DecomposeSubTask',
    });

    const response = await structuredLLM.invoke([
      {
        role: 'system',
        content: `あなたはMinecraftタスク分解アシスタントです。
失敗したサブタスクを、より小さく具体的なサブタスクに分解してください。

失敗理由を分析し、その問題を解決するために必要な前提タスクを追加してください。

例：
- 「石を掘る」が「適切なツールがない」で失敗した場合
  → 「木のツルハシを作る」を前に追加し、「ツルハシで石を掘る」に変更

- 「アイテムをクラフト」が「材料不足」で失敗した場合
  → 「材料Aを集める」「材料Bを集める」を前に追加`
      },
      {
        role: 'user',
        content: `失敗したサブタスク:
目標: ${failedInfo.goal}
失敗理由: ${failedInfo.failureReason}
実行されたアクション: ${failedInfo.executedActions?.join(', ') || 'なし'}

このサブタスクを、成功するために必要な小さなサブタスクに分解してください。`
      }
    ]);

    console.log(`\x1b[32m✓ 分解完了: ${response.newSubTasks.length}個のサブタスクに分解\x1b[0m`);
    console.log(`   理由: ${response.decompositionReason}`);

    // HierarchicalSubTask形式に変換
    const parentId = failedInfo.subTaskId;
    const newSubTasks: HierarchicalSubTask[] = response.newSubTasks.map((st, index) => ({
      id: this.generateSubTaskId(),
      goal: st.goal,
      strategy: st.strategy,
      status: 'pending' as const,
      parentId,
      depth: 1,
      actionSequence: st.actionSequence?.map(a => ({
        toolName: a.toolName,
        args: a.args ? JSON.parse(a.args) : null,
        expectedResult: a.expectedResult,
      })) || null,
    }));

    return newSubTasks;
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

    // === 1. 階層的サブタスク（表示用・自然言語） ===
    // 再帰的な構造（子タスクが子タスクを持てる）
    const HierarchicalSubTaskSchema: z.ZodType<any> = z.lazy(() => z.object({
      id: z.string().describe('サブタスクID'),
      goal: z.string().describe('やること（自然言語）'),
      status: z.enum(['pending', 'in_progress', 'completed', 'error']).describe('ステータス'),
      result: z.string().nullable().optional().describe('結果（完了時）'),
      failureReason: z.string().nullable().optional().describe('エラー理由（失敗時）'),
      children: z.array(HierarchicalSubTaskSchema).nullable().optional().describe('子タスク（階層的）'),
    }));

    // === 2. 次に実行するアクション（実行用・引数完全指定） ===
    const ActionItemSchema = z.object({
      toolName: z.string().describe('実行するツール名'),
      args: z.string().describe(
        '引数のJSON文字列。全ての引数を完全に指定すること。' +
        '例: \'{"blockName": "cobblestone", "maxDistance": 50}\''
      ),
      expectedResult: z.string().describe('期待される結果'),
    });

    // Planning用のスキーマ定義
    const PlanningSchema = z.object({
      status: z.enum(['pending', 'in_progress', 'completed', 'error']),
      goal: z.string(),
      strategy: z.string(),
      emergencyResolved: z.boolean().nullable().describe(
        '緊急時(isEmergency=true)のみ使用。緊急解決=true、緊急未解決=false。通常時は必ずnull。'
      ),

      // === 表示用: タスクの全体像（階層的・自然言語） ===
      hierarchicalSubTasks: z.array(HierarchicalSubTaskSchema).nullable().describe(
        'タスクの全体像を階層的に表現。各サブタスクは自然言語で「やること」を記述。' +
        '子タスクを持つことで階層構造を表現できる。' +
        '例: [{id:"1", goal:"丸石を集める", status:"in_progress", children:[{id:"1-1", goal:"丸石を探す", status:"completed"}]}]'
      ),

      // 現在実行中のサブタスクID
      currentSubTaskId: z.string().nullable().describe('現在実行中のサブタスクのID'),

      // === 実行用: 次に実行するスキル（引数完全指定） ===
      nextActionSequence: z.array(ActionItemSchema).nullable().describe(
        '次に実行するスキルのリスト。引数は全て完全に指定すること。' +
        '前のステップの結果に依存するスキルは含めない（結果を見てから次のPlanningで指定）。' +
        '例: [{toolName:"find-blocks", args:\'{"blockName":"cobblestone"}\', expectedResult:"丸石を発見"}]'
      ),

      // === 後方互換性 ===
      subTasks: z.array(z.object({
        subTaskStatus: z.enum(['pending', 'in_progress', 'completed', 'error']),
        subTaskGoal: z.string(),
        subTaskStrategy: z.string(),
        subTaskResult: z.string().nullable(),
      })).nullable(),
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

      // === 1. 階層的サブタスク（表示用）を表示 ===
      if (response.hierarchicalSubTasks && response.hierarchicalSubTasks.length > 0) {
        console.log(`\x1b[32m📌 HierarchicalSubTasks (タスク全体像):\x1b[0m`);
        this.printHierarchicalSubTasks(response.hierarchicalSubTasks, 0);

        // 保存（そのまま使用）
        this.hierarchicalSubTasks = response.hierarchicalSubTasks;
        this.currentSubTaskId = response.currentSubTaskId || null;
      }

      // === 2. 次に実行するアクション（実行用）を表示 ===
      if (response.nextActionSequence && response.nextActionSequence.length > 0) {
        console.log(`\x1b[32m⚡ NextActionSequence (${response.nextActionSequence.length}個):\x1b[0m`);
        response.nextActionSequence.forEach((action, i) => {
          console.log(`   ${i + 1}. \x1b[35m${action.toolName}\x1b[0m`);
          console.log(`      args: ${action.args}`);
          console.log(`      期待: ${action.expectedResult}`);
        });
      } else {
        console.log('\x1b[33m⚡ NextActionSequence: なし（Planningのみ）\x1b[0m');
      }

      // 旧形式のsubTasksも表示（後方互換性）
      if (response.subTasks && response.subTasks.length > 0) {
        console.log(`\x1b[32m📌 SubTasks (旧形式: ${response.subTasks.length}個):\x1b[0m`);
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
          hierarchicalSubTasks: response.hierarchicalSubTasks,
          nextActionSequence: response.nextActionSequence,
          subTasks: response.subTasks,
          actionCount: response.nextActionSequence?.length || 0,
          subTaskCount: response.hierarchicalSubTasks?.length || 0,
        },
      });

      // 緊急状態が解決されたかチェック
      if (response.emergencyResolved && state.isEmergency) {
        console.log('\x1b[32m✅ LLMが緊急状態の解決を確認しました\x1b[0m');
        if (this.onEmergencyResolved) {
          await this.onEmergencyResolved();
        }
      }

      // nextActionSequenceをパース（無効なargsはスキップ）
      const parsedNextActionSequence = response.nextActionSequence?.map(a => {
        // argsが無効な形式（:null, 空文字, null文字列など）かチェック
        let argsStr = a.args?.trim() || '';

        // 完全に無効なケース
        if (!argsStr || argsStr === 'null' || argsStr.startsWith(':')) {
          console.log(`\x1b[33m⚠ ${a.toolName}: 無効なargs "${a.args}" → スキップ\x1b[0m`);
          return null;
        }

        // シングルクォートをダブルクォートに変換（Python辞書形式対応）
        if (argsStr.includes("'")) {
          argsStr = argsStr.replace(/'/g, '"');
          console.log(`\x1b[33m⚠ ${a.toolName}: シングルクォートをダブルクォートに変換\x1b[0m`);
        }

        try {
          const parsed = JSON.parse(argsStr);
          return {
            toolName: a.toolName,
            args: parsed,
            expectedResult: a.expectedResult,
          };
        } catch (e) {
          console.log(`\x1b[33m⚠ ${a.toolName}: argsのパースに失敗 "${a.args}" → スキップ\x1b[0m`);
          return null;
        }
      }).filter(a => a !== null) || null;

      // 全てスキップされた場合は警告
      if (response.nextActionSequence?.length && parsedNextActionSequence?.length === 0) {
        console.log(`\x1b[31m❌ 全てのアクションが無効でした。\x1b[0m`);
      }

      // taskTreeをUIに送信（「取り組み中のタスク」タブ用）
      const taskTreeForUI = {
        status: response.status,
        goal: response.goal,
        strategy: response.strategy,
        hierarchicalSubTasks: response.hierarchicalSubTasks,
        currentSubTaskId: response.currentSubTaskId,
        subTasks: response.subTasks,
      };
      await sendTaskTreeToServer(taskTreeForUI);

      return {
        taskTree: {
          status: response.status,
          goal: response.goal,
          strategy: response.strategy,
          // 表示用
          hierarchicalSubTasks: response.hierarchicalSubTasks || null,
          currentSubTaskId: response.currentSubTaskId || null,
          // 実行用
          nextActionSequence: parsedNextActionSequence,
          actionSequence: parsedNextActionSequence, // 後方互換性
          // 旧形式
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
          status: 'error',
        },
      });

      // エラー時もtaskTreeをUIに送信
      const errorTaskTree = {
        status: 'error',
        goal: `エラー: ${error instanceof Error ? error.message : '不明なエラー'}`,
        strategy: '',
        subTasks: null,
      };
      await sendTaskTreeToServer(errorTaskTree);

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

  /**
   * 階層的サブタスクを再帰的に表示
   */
  private printHierarchicalSubTasks(tasks: any[], depth: number): void {
    const indent = '   '.repeat(depth);
    const statusIcon = (status: string) => {
      switch (status) {
        case 'completed': return '✓';
        case 'in_progress': return '↻';
        case 'error': return '✗';
        default: return '□';
      }
    };

    tasks.forEach((task, i) => {
      const icon = statusIcon(task.status);
      console.log(`${indent}${icon} \x1b[35m${task.goal}\x1b[0m [${task.status}]`);
      if (task.result) {
        console.log(`${indent}  => ${task.result}`);
      }
      if (task.failureReason) {
        console.log(`${indent}  \x1b[31m✗ ${task.failureReason}\x1b[0m`);
      }
      if (task.children && task.children.length > 0) {
        this.printHierarchicalSubTasks(task.children, depth + 1);
      }
    });
  }

  getLogs() {
    return this.logManager.getLogs();
  }

  clearLogs() {
    this.logManager.clearLogs();
  }
}

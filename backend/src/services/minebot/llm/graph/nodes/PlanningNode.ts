import { ChatOpenAI } from '@langchain/openai';
import { HierarchicalSubTask, TaskTreeState } from '@shannon/common';
import { Vec3 } from 'vec3';
import { z } from 'zod';
import { createLogger } from '../../../../../utils/logger.js';
import { CentralLogManager, LogManager } from '../logging/index.js';
import { Prompt } from '../prompt.js';
import { config } from '../../../../../config/env.js';
import { models } from '../../../../../config/models.js';
import { CONFIG } from '../../../config/MinebotConfig.js';
import { getSkillDependencySummary } from '../../../config/skillDependencies.js';

const log = createLogger('Minebot:Planning');
const SKILL_REF = getSkillDependencySummary();

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
    const response = await fetch(`${CONFIG.UI_MOD_BASE_URL}/task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(taskTree),
    });
    if (!response.ok) {
      log.error(`taskTree送信失敗: ${response.status} ${await response.text()}`);
    }
  } catch (error) {
    log.error('taskTree送信エラー', error);
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

    // === モデル設定 ===
    // 切り替え用: 'o3-mini'(最速), 'gpt-5-mini'(安い), 'o3'(高品質), 'gpt-5'(バランス)
    // reasoning_effort: 'low'(高速), 'medium'(バランス), 'high'(高品質)
    const modelName = models.planning;
    const reasoningEffort = 'low';

    this.model = new ChatOpenAI({
      modelName,
      apiKey: config.openaiApiKey,
      timeout: 45000, // 45秒タイムアウト
      // reasoning modelはtemperature非対応、max_tokensではなくmax_completion_tokensを使う。
      // o3系はLangChainのisReasoningModel()が認識するのでmodelKwargsでの回避は不要だが、
      // 統一性のためmodelKwargsで直接指定。
      modelKwargs: {
        max_completion_tokens: 4096,
        reasoning_effort: reasoningEffort,
      },
    });
    log.info(`🧠 Initialized: model=${modelName}, reasoning_effort=${reasoningEffort}`, 'cyan');
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
    log.warn(`🔧 Decomposing subtask "${failedInfo.goal}" (reason: ${failedInfo.failureReason})`);

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

    // AbortControllerでタイムアウト時にHTTPリクエストも確実にキャンセル
    const decomposeAbort = new AbortController();
    const decomposeTimeout = setTimeout(() => decomposeAbort.abort(), 45000);
    try {
      const response = await structuredLLM.invoke([
        {
          role: 'system',
          content: `あなたはMinecraftタスク分解アシスタントです。
失敗したサブタスクを、より小さく具体的なサブタスクに分解してください。

失敗理由を分析し、その問題を解決するために必要な前提タスクを追加してください。

利用可能なスキル（カテゴリ別・推定実行時間付き）:
${SKILL_REF}

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
      ], { signal: decomposeAbort.signal } as any);
      clearTimeout(decomposeTimeout);

      log.success(`🔧 Decomposed into ${response.newSubTasks.length} subtasks: ${response.decompositionReason}`);

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
    } catch (e: any) {
      clearTimeout(decomposeTimeout);
      if (e.name === 'AbortError' || decomposeAbort.signal.aborted) {
        throw new Error('Decompose LLM timeout (45s)');
      }
      throw e;
    }
  }

  /**
   * 緊急状態解除ハンドラーを設定
   */
  public setEmergencyResolvedHandler(handler: () => Promise<void>): void {
    this.onEmergencyResolved = handler;
  }

  async invoke(state: any): Promise<any> {
    const planningStartTime = Date.now();
    log.info('🧠 戦略を立案中...');

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

    // === Understanding Phase: 環境情報を収集 ===
    const environmentContext = this.gatherEnvironmentContext();

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
      // === Understanding統合: 環境情報を追加 ===
      environment: environmentContext.environment,
      nearbyEntities: environmentContext.nearbyEntities,
      facing: environmentContext.facing,
      nearbyBlocks: environmentContext.nearbyBlocks,
    };

    // 前回の実行結果があればログに表示（consolidated）
    if (state.executionResults) {
      const results = state.executionResults;
      const successCount = results.filter((r: any) => r.success).length;
      const totalCount = results.length;
      const errors = results.filter((r: any) => !r.success);
      if (errors.length > 0) {
        const errorSummary = errors.map((e: any) => `${e.toolName}: ${e.message}`).join(', ');
        log.warn(`📊 前回の実行結果: ${successCount}/${totalCount} 成功, errors: ${errorSummary}`);
      } else {
        log.info(`📊 前回の実行結果: ${successCount}/${totalCount} 成功`, 'cyan');
      }
    }

    // 人間フィードバックがあった場合はメッセージに追加
    if (hadFeedback && state.humanFeedback) {
      log.info(`📝 人間フィードバックを処理: ${state.humanFeedback}`);
    }

    // === 1. 階層的サブタスク（表示用・自然言語） ===
    // フラット構造でparentIdにより親子関係を表現（再帰スキーマ回避）
    const HierarchicalSubTaskSchema = z.object({
      id: z.string().describe('サブタスクID（例: "1", "1-1", "1-1-1"）'),
      parentId: z.string().nullable().describe('親サブタスクのID（トップレベルはnull）'),
      goal: z.string().describe('やること（自然言語）'),
      status: z.enum(['pending', 'in_progress', 'completed', 'error']).describe('ステータス'),
      result: z.string().nullable().describe('結果（完了時）'),
      failureReason: z.string().nullable().describe('エラー理由（失敗時）'),
    });

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

      // === 表示用: タスクの全体像（フラットリスト・parentIdで階層表現） ===
      hierarchicalSubTasks: z.array(HierarchicalSubTaskSchema).nullable().describe(
        'タスクの全体像をフラットリストで表現。parentIdで親子関係を表す。' +
        '例: [{id:"1", parentId:null, goal:"丸石を集める", status:"in_progress"}, {id:"1-1", parentId:"1", goal:"丸石を探す", status:"completed"}]'
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

    // デバッグ: メッセージサイズを計測
    const totalChars = messages.reduce((sum, m) => sum + String(m.content).length, 0);
    log.debug(`📏 Planning messages: ${messages.length}個, 合計${totalChars}文字, isEmergency=${state.isEmergency}`);

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

      // AbortControllerでタイムアウト時にHTTPリクエストも確実にキャンセル
      // Promise.raceだとHTTPリクエストがバックグラウンドで走り続けてしまうため
      const timeoutMs = state.isEmergency ? 30000 : 60000; // 通常60秒、緊急30秒
      const planningAbort = new AbortController();
      const planningTimeout = setTimeout(() => {
        log.error(`⏱ Planning LLM タイムアウト (${timeoutMs / 1000}s) - リクエストを中断`);
        planningAbort.abort();
      }, timeoutMs);
      const startTime = Date.now();
      let response;
      try {
        response = await structuredLLM.invoke(messages, { signal: planningAbort.signal } as any);
        clearTimeout(planningTimeout);
        log.success(`⏱ LLM応答: ${Date.now() - startTime}ms`);
      } catch (e: any) {
        clearTimeout(planningTimeout);
        if (e.name === 'AbortError' || planningAbort.signal.aborted) {
          throw new Error(`Planning LLM timeout (${timeoutMs / 1000}s)`);
        }
        throw e;
      }

      // Planning結果をログ出力（consolidated）
      const emergencyInfo = (response.emergencyResolved != null) ? `, emergencyResolved=${response.emergencyResolved}` : '';
      log.info(`📋 Planning結果: goal="${response.goal}", status=${response.status}${emergencyInfo}`, 'cyan');
      log.info(`📝 Strategy: ${response.strategy}`);

      // === 1. 階層的サブタスク（表示用）を表示 ===
      if (response.hierarchicalSubTasks && response.hierarchicalSubTasks.length > 0) {
        log.info(`📌 SubTasks (${response.hierarchicalSubTasks.length}): ${this.formatSubTaskSummary(response.hierarchicalSubTasks)}`);

        // 保存（そのまま使用）
        this.hierarchicalSubTasks = response.hierarchicalSubTasks;
        this.currentSubTaskId = response.currentSubTaskId || null;
      }

      // === 2. 次に実行するアクション（実行用）を表示 ===
      if (response.nextActionSequence && response.nextActionSequence.length > 0) {
        const actionNames = response.nextActionSequence.map(a => a.toolName).join(', ');
        log.info(`⚡ NextActions (${response.nextActionSequence.length}): ${actionNames}`, 'cyan');
      } else {
        log.debug('⚡ NextActionSequence: なし（Planningのみ）');
      }

      // 旧形式のsubTasksも表示（後方互換性）
      if (response.subTasks && response.subTasks.length > 0) {
        log.debug(`📌 SubTasks (legacy ${response.subTasks.length}): ${response.subTasks.map(t => `[${t.subTaskStatus}] ${t.subTaskGoal}`).join(' | ')}`);
      }

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
        log.success('✅ LLMが緊急状態の解決を確認しました');
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
          log.warn(`⚠ ${a.toolName}: 無効なargs "${a.args}" → スキップ`);
          return null;
        }

        // シングルクォートをダブルクォートに変換（Python辞書形式対応）
        if (argsStr.includes("'")) {
          argsStr = argsStr.replace(/'/g, '"');
        }

        try {
          const parsed = JSON.parse(argsStr);
          return {
            toolName: a.toolName,
            args: parsed,
            expectedResult: a.expectedResult,
          };
        } catch (e) {
          log.warn(`⚠ ${a.toolName}: argsパース失敗 "${a.args}" → スキップ`);
          return null;
        }
      }).filter(a => a !== null) || null;

      // 全てスキップされた場合は警告
      if (response.nextActionSequence?.length && parsedNextActionSequence?.length === 0) {
        log.error('❌ 全てのアクションが無効でした');
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

      log.debug(`🧠 Planning完了: elapsed=${Date.now() - planningStartTime}ms`);

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
      log.error('❌ Planning failed', error);

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
   * 階層的サブタスクの1行サマリーを生成
   */
  private formatSubTaskSummary(tasks: any[]): string {
    const statusIcon = (status: string) => {
      switch (status) {
        case 'completed': return '✓';
        case 'in_progress': return '↻';
        case 'error': return '✗';
        default: return '□';
      }
    };

    const topLevel = tasks.filter((t: any) => !t.parentId);
    const items = topLevel.length > 0 ? topLevel : tasks;
    return items.map((t: any) => `${statusIcon(t.status)} ${t.goal}`).join(' | ');
  }

  getLogs() {
    return this.logManager.getLogs();
  }

  clearLogs() {
    this.logManager.clearLogs();
  }

  /**
   * Understanding Phase: 環境情報を収集
   * UnderstandingNodeから統合した機能
   */
  private gatherEnvironmentContext(): {
    environment: {
      dimension: string;
      weather: string;
      timeOfDay: string;
      biome?: string;
    };
    nearbyEntities: Array<{
      name: string;
      type: string;
      distance: number;
    }>;
    facing: {
      direction: string;
      yaw: number;
      pitch: number;
      blockInSight?: string;
      blockInSightPos?: { x: number; y: number; z: number };
    };
    nearbyBlocks: Record<string, number>;
  } {
    // 1. 周辺エンティティを収集
    const botPosition = this.bot.entity?.position;
    const nearbyEntities: Array<{ name: string; type: string; distance: number }> = [];

    if (botPosition) {
      const entities = Object.values(this.bot.entities) as any[];
      for (const entity of entities) {
        if (!entity.position || entity === this.bot.entity) continue;

        const distance = entity.position.distanceTo(botPosition);
        if (distance < 20) {
          nearbyEntities.push({
            name: entity.name || entity.username || 'unknown',
            type: entity.type || 'unknown',
            distance: Math.round(distance * 10) / 10,
          });
        }
      }
      // 距離でソートして最大10件
      nearbyEntities.sort((a, b) => a.distance - b.distance);
      nearbyEntities.splice(10);
    }

    // 2. 環境情報
    // Minecraft時間: 0=6:00, 6000=12:00, 12000=18:00, 18000=0:00
    const timeOfDay = this.bot.time?.timeOfDay || 0;
    let timeString: string;
    if (timeOfDay < 6000) {
      // 0-6000 = 6:00-12:00
      timeString = 'morning';
    } else if (timeOfDay < 12000) {
      // 6000-12000 = 12:00-18:00
      timeString = 'afternoon';
    } else if (timeOfDay < 13000) {
      // 12000-13000 = 18:00-19:00
      timeString = 'evening';
    } else {
      // 13000-24000 = 19:00-6:00
      timeString = 'night';
    }

    const environment = {
      dimension: this.bot.game?.dimension || 'overworld',
      weather: this.bot.isRaining ? 'raining' : 'clear',
      timeOfDay: timeString,
      biome: this.bot.environmentState?.biome || undefined,
    };

    // 3. 向いている方角と視線先ブロック
    const entity = this.bot.entity as any;
    const yaw = entity?.yaw || 0;
    const pitch = entity?.pitch || 0;

    // yawから方角を計算（mineflayer: yaw=0→南, yaw=π/2→西, yaw=π→北, yaw=-π/2→東）
    const compassDirections = ['south', 'southwest', 'west', 'northwest', 'north', 'northeast', 'east', 'southeast'];
    // yawを0-2πの範囲に正規化
    const normalizedYaw = ((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const dirIndex = Math.round(normalizedYaw / (Math.PI / 4)) % 8;
    const compassDirection = compassDirections[dirIndex];

    // 視線先ブロック（レイキャスト）
    let blockInSight: string | undefined;
    let blockInSightPos: { x: number; y: number; z: number } | undefined;
    try {
      const block = (this.bot as any).blockAtCursor?.(10);
      if (block && block.name !== 'air') {
        blockInSight = block.name;
        blockInSightPos = { x: block.position.x, y: block.position.y, z: block.position.z };
      }
    } catch (_) {
      // blockAtCursor が使えない場合はフォールバック: 手動レイキャスト
      if (botPosition) {
        const eyePos = botPosition.offset(0, 1.62, 0);
        // mineflayer: yaw=0→北(-Z), pitch>0→上向き
        const dirX = -Math.sin(yaw) * Math.cos(pitch);
        const dirY = Math.sin(pitch);
        const dirZ = -Math.cos(yaw) * Math.cos(pitch);
        for (let dist = 1; dist <= 8; dist += 0.5) {
          const checkPos = eyePos.offset(dirX * dist, dirY * dist, dirZ * dist);
          const block = this.bot.blockAt(checkPos);
          if (block && block.name !== 'air') {
            blockInSight = block.name;
            blockInSightPos = { x: block.position.x, y: block.position.y, z: block.position.z };
            break;
          }
        }
      }
    }

    const facing = {
      direction: compassDirection,
      yaw: Math.round(yaw * 180 / Math.PI),
      pitch: Math.round(pitch * 180 / Math.PI),
      blockInSight,
      blockInSightPos,
    };

    // 4. 周囲ブロック概要（半径5ブロック、air/cave_air/void_airを除外）
    const nearbyBlocks: Record<string, number> = {};
    const SKIP_BLOCKS = new Set(['air', 'cave_air', 'void_air']);
    const SCAN_RADIUS = 5;

    if (botPosition) {
      const cx = Math.floor(botPosition.x);
      const cy = Math.floor(botPosition.y);
      const cz = Math.floor(botPosition.z);

      for (let dx = -SCAN_RADIUS; dx <= SCAN_RADIUS; dx++) {
        for (let dy = -SCAN_RADIUS; dy <= SCAN_RADIUS; dy++) {
          for (let dz = -SCAN_RADIUS; dz <= SCAN_RADIUS; dz++) {
            try {
              const block = this.bot.blockAt(new Vec3(cx + dx, cy + dy, cz + dz));
              if (block && !SKIP_BLOCKS.has(block.name)) {
                nearbyBlocks[block.name] = (nearbyBlocks[block.name] || 0) + 1;
              }
            } catch (_) {
              // ブロック取得失敗は無視
            }
          }
        }
      }
    }

    // 多いものから上位15種に絞る
    const sortedBlocks: Record<string, number> = {};
    Object.entries(nearbyBlocks)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .forEach(([name, count]) => {
        sortedBlocks[name] = count;
      });

    return { environment, nearbyEntities, facing, nearbyBlocks: sortedBlocks };
  }
}

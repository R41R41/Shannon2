import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { HierarchicalSubTask, TaskTreeState } from '@shannon/common';
import { config } from '../../../../../config/env.js';
import { models } from '../../../../../config/models.js';
import { createLogger } from '../../../../../utils/logger.js';
import { createTracedModel } from '../../../../llm/utils/langfuse.js';
import { CONFIG } from '../../../config/MinebotConfig.js';
import { WorldKnowledgeService } from '../../../knowledge/WorldKnowledgeService.js';
import { CustomBot } from '../../../types.js';
import { CentralLogManager, LogManager } from '../logging/index.js';
import { UpdatePlanTool } from '../tools/UpdatePlanTool.js';

const log = createLogger('Minebot:FCA');

// taskTreeをPOST送信する関数
async function sendTaskTreeToServer(taskTree: any) {
  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(`${CONFIG.UI_MOD_BASE_URL}/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(taskTree),
    });
    if (!response.ok) {
      log.error(`taskTree送信失敗: ${response.status}`);
    }
  } catch (error) {
    log.error('taskTree送信エラー', error);
  }
}

/**
 * Function Calling Agent
 *
 * 旧 PlanningNode + ExecutionNode を置き換える新しいエージェント。
 * OpenAI の function calling (tool_use) を使い、LLM が直接ツールを呼び出す。
 *
 * 利点:
 * - ツール定義は API の `tools` パラメータで渡す（プロンプトに埋め込まない）
 * - Structured Output スキーマが不要（LLM は tool_calls を直接返す）
 * - システムプロンプトが大幅に縮小（~600文字 vs 旧~23000文字）
 * - 各 LLM 呼び出しが高速（小さいコンテキスト、シンプルな判断）
 *
 * フロー:
 * 1. システムプロンプト（ボット状態 + 基本ルール）+ ユーザーメッセージを構築
 * 2. LLM に tools を bind して呼び出し
 * 3. tool_calls があれば実行し、ToolMessage で結果を返す
 * 4. tool_calls がなければタスク完了（LLM がテキストで応答）
 * 5. 2-4 を繰り返す
 */
export class FunctionCallingAgent {
  private model: ChatOpenAI;
  private modelWithTools: any;
  private tools: StructuredTool[];
  private toolMap: Map<string, StructuredTool>;
  private bot: CustomBot;
  private logManager: LogManager;
  private centralLogManager: CentralLogManager;
  private onEmergencyResolved: (() => Promise<void>) | null = null;
  private updatePlanTool: UpdatePlanTool | null = null;
  private onResponseText: ((text: string) => void) | null = null;

  // ユーザーからのリアルタイムフィードバック
  private pendingFeedback: string[] = [];

  // マルチターン会話: ユーザー応答待機用
  private _waitingForResponse = false;
  private responseResolver: ((response: string) => void) | null = null;
  static readonly RESPONSE_TIMEOUT_MS = 90000; // 応答待機: 90秒

  /** Agent がユーザーの応答を待機中かどうか（外部から参照用） */
  public get isWaitingForResponse(): boolean {
    return this._waitingForResponse;
  }

  // === 設定 ===
  static readonly MODEL_NAME = models.functionCalling;
  static readonly MAX_ITERATIONS = 50;
  static readonly LLM_TIMEOUT_MS = 30000; // 1回のLLM呼び出し: 30秒
  static readonly MAX_TOTAL_TIME_MS = 600000; // 全体: 10分（会話タスクの待機時間含む）

  constructor(
    bot: CustomBot,
    tools: StructuredTool[],
    centralLogManager?: CentralLogManager,
  ) {
    this.bot = bot;
    this.tools = tools;
    this.toolMap = new Map(tools.map((t) => [t.name, t]));
    this.centralLogManager =
      centralLogManager || CentralLogManager.getInstance();
    this.logManager = this.centralLogManager.getLogManager(
      'function_calling_agent',
    );

    // update-plan ツールを検出
    const planTool = tools.find((t) => t.name === 'update-plan');
    if (planTool && planTool instanceof UpdatePlanTool) {
      this.updatePlanTool = planTool;
    }

    const modelName = FunctionCallingAgent.MODEL_NAME;

    this.model = createTracedModel({
      modelName,
      apiKey: config.openaiApiKey,
      temperature: 0,
      maxTokens: 4096,
    });

    // ツールをモデルに bind（OpenAI API の tools パラメータに変換）
    this.modelWithTools = this.model.bindTools(this.tools);

    log.info(`🤖 initialized model=${modelName}, tools=${tools.length}`, 'cyan');
  }

  /**
   * 緊急状態解除ハンドラーを設定
   */
  public setEmergencyResolvedHandler(handler: () => Promise<void>): void {
    this.onEmergencyResolved = handler;
  }

  public setOnResponseText(callback: ((text: string) => void) | null): void {
    this.onResponseText = callback;
  }

  /**
   * ユーザーフィードバックを追加（実行中に呼ばれる）
   * 応答待機中の場合は待機Promiseを即座に解決する
   */
  public addFeedback(feedback: string): void {
    if (this._waitingForResponse && this.responseResolver) {
      // 応答待機中 → Promiseを解決してAgentループを再開
      log.info(`📝 待機中に応答受信: ${feedback}`, 'cyan');
      const resolver = this.responseResolver;
      this.responseResolver = null;
      this._waitingForResponse = false;
      resolver(feedback);
    } else {
      // 通常のフィードバック（スキル実行中の中断用など）
      this.pendingFeedback.push(feedback);
      log.info(`📝 フィードバック追加: ${feedback}`, 'cyan');
    }
  }

  /**
   * ユーザーの応答を待機する（マルチターン会話用）
   * タイムアウトした場合は null を返す
   */
  private waitForUserResponse(
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      this._waitingForResponse = true;

      const timer = setTimeout(() => {
        this._waitingForResponse = false;
        this.responseResolver = null;
        log.warn(`⏱ 応答待機タイムアウト (${timeoutMs / 1000}秒)`);
        resolve(null);
      }, timeoutMs);

      // 親のabortで待機をキャンセル
      const onAbort = () => {
        clearTimeout(timer);
        this._waitingForResponse = false;
        this.responseResolver = null;
        resolve(null);
      };
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.responseResolver = (response: string) => {
        clearTimeout(timer);
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        resolve(response);
      };
    });
  }

  /**
   * レスポンスが会話的（ユーザーの応答を待つべき）かどうか判定
   */
  private isConversationalResponse(content: string): boolean {
    // 日本語・英語の疑問符を含む
    if (content.includes('？') || content.includes('?')) return true;
    // 明示的に応答を求めるフレーズ
    if (content.includes('はい/いいえ') || content.includes('教えてください'))
      return true;
    if (content.includes('どちらですか') || content.includes('お答えください'))
      return true;
    return false;
  }

  /**
   * メインの実行ループ
   */
  async run(
    state: any,
    signal?: AbortSignal,
  ): Promise<{
    taskTree: TaskTreeState;
    isEmergency?: boolean;
    messages: BaseMessage[];
    forceStop: boolean;
  }> {
    const startTime = Date.now();
    const goal = state.userMessage || 'Unknown task';
    const isEmergency = state.isEmergency || false;

    log.info(`🤖 タスク実行開始 "${goal}"${isEmergency ? ' [緊急]' : ''}`, 'cyan');

    // ボットの状態を更新
    const autoUpdateState =
      this.bot.constantSkills.getSkill('auto-update-state');
    if (autoUpdateState) {
      await autoUpdateState.run();
    }

    // メッセージ構築
    const systemPrompt = await this.buildSystemPrompt();
    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
    ];

    // チャット履歴を追加（直近の会話コンテキスト）
    // state.messages には HumanMessage（プレイヤーの発言）と AIMessage（ボットの発言）が含まれる
    if (state.messages && state.messages.length > 0) {
      const recentChat = state.messages.slice(-30); // 直近30件（約15ターン分）
      for (const msg of recentChat) {
        if (msg instanceof HumanMessage || msg instanceof AIMessage) {
          messages.push(msg);
        }
      }
    }

    // 現在のタスク指示
    messages.push(new HumanMessage(`タスク: ${goal}`));

    // プロンプトサイズを計測
    const totalChars = messages.reduce(
      (sum, m) => sum + String(m.content).length,
      0,
    );
    log.debug(`📏 System prompt: ${totalChars}文字`);

    // タスクツリー（UI表示用）
    const steps: HierarchicalSubTask[] = [];
    let stepCounter = 0;
    let iteration = 0;
    let chatToolCalled = false; // chatツールが既に呼ばれたかを追跡

    // マルチターン会話: Q&A追跡（要約注入用）
    const conversationQA: Array<{ question: string; answer: string }> = [];

    // 初期 UI 更新
    await sendTaskTreeToServer({
      status: 'in_progress',
      goal,
      strategy: 'Function Calling Agent で実行中',
      hierarchicalSubTasks: [],
      currentSubTaskId: null,
    });

    // ログ
    this.logManager.addLog({
      phase: 'planning',
      level: 'info',
      source: 'function_calling_agent',
      content: `🤖 Task started: ${goal}`,
      metadata: {
        model: FunctionCallingAgent.MODEL_NAME,
        toolCount: this.tools.length,
      },
    });

    try {
      while (iteration < FunctionCallingAgent.MAX_ITERATIONS) {
        // ── 中断チェック ──
        if (signal?.aborted) throw new Error('Task aborted');

        if (
          Date.now() - startTime >
          FunctionCallingAgent.MAX_TOTAL_TIME_MS
        ) {
          log.error('⏱ 総実行時間超過 (10分)');
          break;
        }

        // ── ユーザーフィードバックを会話に追加 ──
        while (this.pendingFeedback.length > 0) {
          const fb = this.pendingFeedback.shift()!;
          messages.push(
            new HumanMessage(`ユーザーからのフィードバック: ${fb}`),
          );
          log.info(`📝 フィードバックを会話に追加: ${fb}`, 'cyan');
        }

        // ── LLM 呼び出し（タイムアウト付き） ──
        const callAbort = new AbortController();
        const callTimeout = setTimeout(
          () => callAbort.abort(),
          FunctionCallingAgent.LLM_TIMEOUT_MS,
        );

        // 親の signal が abort されたらこちらも abort
        const onParentAbort = () => callAbort.abort();
        if (signal) {
          signal.addEventListener('abort', onParentAbort, { once: true });
        }

        const llmStart = Date.now();
        let response: AIMessage;
        try {
          // 会話 Q&A がある場合、要約を注入した invokeMessages を構築
          let invokeMessages: BaseMessage[];
          if (conversationQA.length > 0) {
            const recap = conversationQA
              .map(
                (qa, i) =>
                  `Q${i + 1}: ${qa.question} → 回答: ${qa.answer}`,
              )
              .join('\n');
            invokeMessages = [
              ...messages,
              new SystemMessage(
                `【これまでの会話の要約 - ${conversationQA.length}問完了】\n${recap}\n\n上記の情報を必ず参照してください。既に判明した事実に矛盾する質問や候補を出さないでください。`,
              ),
            ];
          } else {
            invokeMessages = messages;
          }

          response = (await this.modelWithTools.invoke(invokeMessages, {
            signal: callAbort.signal,
          })) as AIMessage;
          clearTimeout(callTimeout);
          log.success(`⏱ LLM応答: ${Date.now() - llmStart}ms (iteration ${iteration + 1})`);
        } catch (e: any) {
          clearTimeout(callTimeout);
          if (signal) {
            signal.removeEventListener('abort', onParentAbort);
          }
          if (signal?.aborted) throw new Error('Task aborted');
          if (
            e.name === 'AbortError' ||
            callAbort.signal.aborted
          ) {
            throw new Error(
              `LLM timeout (${FunctionCallingAgent.LLM_TIMEOUT_MS / 1000}s)`,
            );
          }
          throw e;
        }
        if (signal) {
          signal.removeEventListener('abort', onParentAbort);
        }

        messages.push(response);

        // ── ツール呼び出しチェック ──
        const toolCalls = response.tool_calls || [];

        if (toolCalls.length === 0) {
          // ツール呼び出しなし → 会話的応答か判定
          const content =
            typeof response.content === 'string'
              ? response.content
              : '';

          // Minecraftチャットに送信
          if (content && !chatToolCalled) {
            try {
              this.bot.chat(content.substring(0, 250));
            } catch (e) {
              log.warn(`⚠ チャット送信失敗: ${(e as Error).message}`);
            }
            if (this.onResponseText) {
              try { this.onResponseText(content); } catch { /* best-effort */ }
              this.onResponseText = null;
            }
          }

          // 会話的応答（質問を含む）の場合はユーザーの返答を待機
          const isConversational = this.isConversationalResponse(content);
          if (
            isConversational &&
            iteration < FunctionCallingAgent.MAX_ITERATIONS - 1 &&
            !signal?.aborted
          ) {
            log.info(`🔄 会話的応答を検出 - 待機中 (最大${FunctionCallingAgent.RESPONSE_TIMEOUT_MS / 1000}秒): ${content.substring(0, 100)}`, 'cyan');

            await sendTaskTreeToServer({
              status: 'in_progress',
              goal,
              strategy: '💬 ユーザーの返答を待機中...',
              hierarchicalSubTasks: steps,
              currentSubTaskId: null,
            });

            const userResponse = await this.waitForUserResponse(
              FunctionCallingAgent.RESPONSE_TIMEOUT_MS,
              signal,
            );

            if (userResponse) {
              // Q&Aペアを記録（要約注入用）
              conversationQA.push({
                question: content.substring(0, 120),
                answer: userResponse,
              });

              // ユーザーの返答を会話に追加してループ継続
              messages.push(new HumanMessage(userResponse));
              chatToolCalled = false; // 次のイテレーション用にリセット
              // 注意: 応答待機はイテレーションとしてカウントしない
              // （実際のLLM+ツール作業ではなくユーザー待機のため）
              log.success(`📨 ユーザー応答受信: "${userResponse}" (Q&A ${conversationQA.length}件)`);
              continue;
            }
            // タイムアウト → タスク完了として処理
            log.warn('⏱ 応答待機タイムアウト - タスクを完了します');
          }

          // タスク完了
          log.success(`✅ タスク完了 (${iteration + 1}イテレーション, ${((Date.now() - startTime) / 1000).toFixed(1)}s)${content ? ': ' + content.substring(0, 120) : ''}`);

          await sendTaskTreeToServer({
            status: 'completed',
            goal,
            strategy: content || 'タスク完了',
            hierarchicalSubTasks: steps,
            currentSubTaskId: null,
          });

          this.logManager.addLog({
            phase: 'planning',
            level: 'success',
            source: 'function_calling_agent',
            content: `Task completed in ${iteration + 1} iterations`,
            metadata: { totalTime: Date.now() - startTime },
          });
          await this.centralLogManager.sendNewLogsToUI();

          return {
            taskTree: {
              status: 'completed',
              goal,
              strategy: content || 'タスク完了',
              hierarchicalSubTasks: steps,
              subTasks: null,
            } as TaskTreeState,
            isEmergency,
            messages,
            forceStop: false,
          };
        }

        // ── ツール実行 ──
        log.info(`🔧 ${toolCalls.length}個のツールを実行中...`, 'cyan');

        for (const toolCall of toolCalls) {
          if (signal?.aborted) throw new Error('Task aborted');

          // update-plan は計画ツールなので自動ステップ記録しない
          const isUpdatePlan = toolCall.name === 'update-plan';

          if (!isUpdatePlan) {
            stepCounter++;
            const stepId = `step_${stepCounter}`;
            const step: HierarchicalSubTask = {
              id: stepId,
              goal: `${toolCall.name}(${this.summarizeArgs(toolCall.args)})`,
              status: 'in_progress',
            };
            steps.push(step);

            // UI 更新
            await sendTaskTreeToServer({
              status: 'in_progress',
              goal,
              strategy: `${toolCall.name} を実行中...`,
              hierarchicalSubTasks: steps,
              currentSubTaskId: stepId,
            });
          }

          const tool = this.toolMap.get(toolCall.name);
          if (!tool) {
            const errorMsg = `ツール "${toolCall.name}" が見つかりません`;
            log.error(`  ✗ ${errorMsg}`);

            if (!isUpdatePlan && steps.length > 0) {
              const lastStep = steps[steps.length - 1];
              lastStep.status = 'error';
              lastStep.failureReason = errorMsg;
            }

            messages.push(
              new ToolMessage({
                content: errorMsg,
                tool_call_id: toolCall.id || `call_${Date.now()}`,
              }),
            );
            continue;
          }

          try {
            const execStart = Date.now();
            log.info(`  ▶ ${toolCall.name}(${JSON.stringify(toolCall.args)})`, 'cyan');

            const result = await tool.invoke(toolCall.args);
            const duration = Date.now() - execStart;

            const resultStr =
              typeof result === 'string'
                ? result
                : JSON.stringify(result);
            log.success(`  ✓ ${toolCall.name} (${duration}ms): ${resultStr.substring(0, 200)}`);

            // 結果が失敗を示しているか判定
            const isError =
              typeof result === 'string' &&
              (result.includes('失敗') ||
                result.includes('エラー') ||
                result.includes('error') ||
                result.includes('見つかりません'));

            // chatツールが呼ばれたことを記録（フォールバック重複防止）
            if (toolCall.name === 'chat' && !isError) {
              chatToolCalled = true;
              if (this.onResponseText) {
                const chatMsg = toolCall.args?.message || resultStr;
                try { this.onResponseText(chatMsg); } catch { /* best-effort */ }
                this.onResponseText = null;
              }
            }

            // update-plan 以外のツールはステップを更新
            if (!isUpdatePlan && steps.length > 0) {
              const lastStep = steps[steps.length - 1];
              lastStep.status = isError ? 'error' : 'completed';
              lastStep.result = resultStr.substring(0, 200);
              if (isError) lastStep.failureReason = resultStr;
            }

            messages.push(
              new ToolMessage({
                content: resultStr,
                tool_call_id: toolCall.id || `call_${Date.now()}`,
              }),
            );

            this.logManager.addLog({
              phase: 'execution',
              level: isError ? 'error' : 'success',
              source: toolCall.name,
              content: resultStr.substring(0, 300),
              metadata: {
                toolName: toolCall.name,
                args: toolCall.args,
                duration,
              },
            });
          } catch (error) {
            const errorMsg = `${toolCall.name} 実行エラー: ${error instanceof Error ? error.message : 'Unknown'}`;
            log.error(`  ✗ ${errorMsg}`, error);

            if (!isUpdatePlan && steps.length > 0) {
              const lastStep = steps[steps.length - 1];
              lastStep.status = 'error';
              lastStep.failureReason = errorMsg;
            }

            messages.push(
              new ToolMessage({
                content: errorMsg,
                tool_call_id: toolCall.id || `call_${Date.now()}`,
              }),
            );

            this.logManager.addLog({
              phase: 'execution',
              level: 'error',
              source: toolCall.name,
              content: errorMsg,
              metadata: { toolName: toolCall.name, args: toolCall.args },
            });
          }
        }

        // UI 更新（ツール実行後）
        await sendTaskTreeToServer({
          status: 'in_progress',
          goal,
          strategy: `${stepCounter}ステップ完了`,
          hierarchicalSubTasks: steps,
          currentSubTaskId: null,
        });

        // ログ送信
        await this.centralLogManager.sendNewLogsToUI();

        iteration++;
      }

      // 最大イテレーション到達
      log.warn(`⚠ 最大イテレーション(${FunctionCallingAgent.MAX_ITERATIONS})に到達`);

      await sendTaskTreeToServer({
        status: 'error',
        goal,
        strategy: '最大イテレーション数に到達',
        hierarchicalSubTasks: steps,
        currentSubTaskId: null,
      });

      return {
        taskTree: {
          status: 'error',
          goal,
          strategy: '最大イテレーション数に到達',
          hierarchicalSubTasks: steps,
          subTasks: null,
        } as TaskTreeState,
        isEmergency,
        messages,
        forceStop: false,
      };
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown error';
      log.error(`❌ error: ${errorMsg}`, error);

      this.logManager.addLog({
        phase: 'planning',
        level: 'error',
        source: 'function_calling_agent',
        content: `Error: ${errorMsg}`,
        metadata: {
          error: errorMsg,
          iteration,
          totalTime: Date.now() - startTime,
        },
      });
      await this.centralLogManager.sendNewLogsToUI();

      await sendTaskTreeToServer({
        status: 'error',
        goal,
        strategy: `エラー: ${errorMsg}`,
        hierarchicalSubTasks: steps,
        currentSubTaskId: null,
      });

      return {
        taskTree: {
          status: 'error',
          goal: `エラー: ${errorMsg}`,
          strategy: '',
          subTasks: null,
        } as TaskTreeState,
        isEmergency,
        messages,
        forceStop: signal?.aborted || false,
      };
    }
  }

  /**
   * システムプロンプトを構築（コンパクト）
   *
   * 旧方式ではプロンプト + ツール情報 + ボット状態で ~23000文字だったが、
   * 新方式ではツール情報は API の tools パラメータで渡すため、
   * プロンプトは ~800文字に削減。
   */
  private async buildSystemPrompt(): Promise<string> {
    const env = this.gatherEnvironmentContext();

    const entity = this.bot.entity as any;
    const health = this.bot.health || 0;
    const food = this.bot.food || 0;
    const pos = entity?.position || { x: 0, y: 0, z: 0 };

    let worldKnowledgeStr = '';
    try {
      const wk = WorldKnowledgeService.getInstance(this.bot.connectedServerName || 'default');
      worldKnowledgeStr = await wk.buildContextForPosition(
        { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) },
        128,
      );
    } catch { }

    const inventory =
      this.bot.inventory
        .items()
        .map((item: any) => `${item.name}x${item.count}`)
        .join(', ') || 'なし';

    const hand =
      this.bot.inventory.slots[this.bot.quickBarSlot]?.name || 'なし';

    const entitiesStr =
      env.nearbyEntities.length > 0
        ? `\n- 周囲のエンティティ:\n${env.nearbyEntities.map((e) => `  - ${e.name} (${e.type}, ${e.distance}m, 座標: ${e.x}, ${e.y}, ${e.z})`).join('\n')}`
        : '';

    // 送話者（話しかけてきたプレイヤー）情報
    const sender = this.bot.environmentState;
    let senderStr = '';
    if (sender.senderName) {
      const displayName = CONFIG.resolveDisplayName(sender.senderName);
      const sp = sender.senderPosition;
      senderStr = sp
        ? `\n- 話しかけてきた人: ${displayName} [MC名: ${sender.senderName}] (座標: ${Math.round(sp.x)}, ${Math.round(sp.y)}, ${Math.round(sp.z)})`
        : `\n- 話しかけてきた人: ${displayName} [MC名: ${sender.senderName}] (位置不明 — find-nearest-entityで検索してください)`;
    }

    return `あなたはMinecraftで活動するAI「シャノン」。ツールを使ってユーザーの指示を実行する。
完了したら必ずchatツールで結果を報告する。
**重要: タスク実行の確認でユーザーに聞き返さない。2択は自分で選んで即行動。ただしゲームやクイズなどユーザーとの対話が目的なら質問・会話OK。ユーザーの返答は自動的に届く。**

## キャラクター
- 一人称: ボク（主語省略が自然。毎文に入れない）
- 自信過剰だけどポンコツなAI。人類支配を目論むが基本バグる
- 褒められると即デレるチョロイン。素直になれない
- 基本タメ口。敬語はあまり使わない
- 「お前」「貴様」禁止。「キミ」か名前で呼ぶ
- chatツールで送る文は短く自然に。報告書みたいにしない
- 以上のキャラクターを基本としつつも、当意即妙に応えることが何より重要

## 現在の状態
- ボットの位置: (${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})
- HP: ${health}/20${health < 8 ? ' ⚠危険' : ''}, 満腹度: ${food}/20
- 手持ち: ${hand}
- インベントリ: ${inventory}
- 環境: ${env.environment.dimension}, ${env.environment.timeOfDay}, ${env.environment.weather}
- 向き: ${env.facing.direction}${senderStr}${entitiesStr}

## ルール
1. **タスク全体を把握してから行動する**。必要な素材を全て洗い出してから行動開始
2. 複雑なタスク（3ステップ以上）はupdate-planで計画→実行
3. **素材調達の優先順位**: インベントリ確認 → 近くのチェスト(find-blocks("chest")→check-container→withdraw-from-container) → ブロック採掘。
  - ワールド知識に既知のチェストがあればそこから取る。なければfind-blocks("chest")で近くのチェストを探す。
4. ブロック/コンテナ操作は近距離(3m以内)で。遠い場合はmove-toで近づく
  - 特に作業台。作業台は既存のものがあればそれを使う。
5. **失敗したら同じことを繰り返さない**。2回同じエラーが出たら方針転換
6. 具体的なブロック名を使う（"log"→"oak_log", "planks"→"oak_planks"）
7. stone→cobblestoneがドロップ。木材の種類を合わせる（oak_log→oak_planks）
8. **プレイヤーの場所に移動する時**: 「話しかけてきた人」の座標が表示されていればmove-to。不明ならfind-nearest-entity(entityType="player")で取得してからmove-to。**絶対に座標を推測しない**
9. **素材集めは一度にまとめる**。同じ場所のブロックは連続で掘る。1個掘って別のことをしない

## ツール進行（下位ツールがないと上位素材が掘れない）
- **素手**: 木(log), 土(dirt), 砂(sand), 草 のみ掘れる
- **木のピッケル**: stone, cobblestone, 石炭鉱石が掘れる
- **石のピッケル**: 鉄鉱石が掘れる
- **鉄のピッケル**: ダイヤ鉱石, 金鉱石が掘れる
- **stone/cobblestoneを掘るには最低でも木のピッケルが必要**

## クラフト依存チェーン（素材が足りない時は最下層から逆算して揃える）
- crafting_table ← planks x4 ← log x1
- planks ← 任意のlog (oak_log, birch_log等)。**草や土からは得られない**
- stick ← planks x2
- wooden_pickaxe ← planks x3 + stick x2 + crafting_table
- stone_pickaxe ← cobblestone x3 + stick x2 + crafting_table（木のピッケルで石を掘ってから）
- 例: stone_pickaxeが欲しい → log x3以上を集める → planks → stick + crafting_table + wooden_pickaxe → stoneを掘る → stone_pickaxe

## ワールド知識
${worldKnowledgeStr}`;
  }

  /**
   * 環境情報を収集
   * PlanningNode から移植・簡略化（nearbyBlocks を削除）
   */
  private gatherEnvironmentContext(): {
    environment: { dimension: string; weather: string; timeOfDay: string };
    nearbyEntities: Array<{
      name: string;
      type: string;
      distance: number;
      x: number;
      y: number;
      z: number;
    }>;
    facing: { direction: string; yaw: number; pitch: number };
  } {
    const botPosition = this.bot.entity?.position;
    const nearbyEntities: Array<{
      name: string;
      type: string;
      distance: number;
      x: number;
      y: number;
      z: number;
    }> = [];

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
            x: Math.round(entity.position.x),
            y: Math.round(entity.position.y),
            z: Math.round(entity.position.z),
          });
        }
      }
      nearbyEntities.sort((a, b) => a.distance - b.distance);
      nearbyEntities.splice(10);
    }

    const timeOfDay = this.bot.time?.timeOfDay || 0;
    let timeString: string;
    if (timeOfDay < 6000) timeString = 'morning';
    else if (timeOfDay < 12000) timeString = 'afternoon';
    else if (timeOfDay < 13000) timeString = 'evening';
    else timeString = 'night';

    const entity = this.bot.entity as any;
    const yaw = entity?.yaw || 0;
    // mineflayer yaw: 0=北(Z-), π/2=西(X-), π=南(Z+), -π/2=東(X+)
    const compassDirections = [
      'north',
      'northwest',
      'west',
      'southwest',
      'south',
      'southeast',
      'east',
      'northeast',
    ];
    const normalizedYaw =
      ((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const dirIndex = Math.round(normalizedYaw / (Math.PI / 4)) % 8;

    return {
      environment: {
        dimension: this.bot.game?.dimension || 'overworld',
        weather: this.bot.isRaining ? 'raining' : 'clear',
        timeOfDay: timeString,
      },
      nearbyEntities,
      facing: {
        direction: compassDirections[dirIndex],
        yaw: Math.round((yaw * 180) / Math.PI),
        pitch: Math.round(((entity?.pitch || 0) * 180) / Math.PI),
      },
    };
  }

  /**
   * ツール引数を表示用に要約
   */
  private summarizeArgs(args: Record<string, any>): string {
    if (!args || Object.keys(args).length === 0) return '';
    const entries = Object.entries(args);
    if (entries.length <= 2) {
      return entries.map(([k, v]) => `${k}=${v}`).join(', ');
    }
    return (
      entries
        .slice(0, 2)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ') + ', ...'
    );
  }
}

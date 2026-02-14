import { ChatOpenAI } from '@langchain/openai';
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';
import { TaskTreeState, HierarchicalSubTask } from '@shannon/common';
import { CustomBot } from '../../../types.js';
import { CentralLogManager, LogManager } from '../logging/index.js';
import { UpdatePlanTool } from '../tools/UpdatePlanTool.js';
import { config } from '../../../../../config/env.js';
import { models } from '../../../../../config/models.js';

// taskTreeをPOST送信する関数
async function sendTaskTreeToServer(taskTree: any) {
  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch('http://localhost:8081/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(taskTree),
    });
    if (!response.ok) {
      console.error('taskTree送信失敗:', response.status);
    }
  } catch (error) {
    console.error('taskTree送信エラー:', error);
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

    this.model = new ChatOpenAI({
      modelName,
      apiKey: config.openaiApiKey,
      temperature: 0,
      maxTokens: 4096,
    });

    // ツールをモデルに bind（OpenAI API の tools パラメータに変換）
    this.modelWithTools = this.model.bindTools(this.tools);

    console.log(
      `\x1b[36m🤖 FunctionCallingAgent: model=${modelName}, tools=${tools.length}\x1b[0m`,
    );
  }

  /**
   * 緊急状態解除ハンドラーを設定
   */
  public setEmergencyResolvedHandler(handler: () => Promise<void>): void {
    this.onEmergencyResolved = handler;
  }

  /**
   * ユーザーフィードバックを追加（実行中に呼ばれる）
   * 応答待機中の場合は待機Promiseを即座に解決する
   */
  public addFeedback(feedback: string): void {
    if (this._waitingForResponse && this.responseResolver) {
      // 応答待機中 → Promiseを解決してAgentループを再開
      console.log(
        `\x1b[33m📝 FunctionCallingAgent: 待機中に応答受信: ${feedback}\x1b[0m`,
      );
      const resolver = this.responseResolver;
      this.responseResolver = null;
      this._waitingForResponse = false;
      resolver(feedback);
    } else {
      // 通常のフィードバック（スキル実行中の中断用など）
      this.pendingFeedback.push(feedback);
      console.log(
        `\x1b[33m📝 FunctionCallingAgent: フィードバック追加: ${feedback}\x1b[0m`,
      );
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
        console.log(
          `\x1b[33m⏱ 応答待機タイムアウト (${timeoutMs / 1000}秒)\x1b[0m`,
        );
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

    console.log(
      `\x1b[36m🤖 FunctionCallingAgent: タスク実行開始 "${goal}"${isEmergency ? ' [緊急]' : ''}\x1b[0m`,
    );

    // ボットの状態を更新
    const autoUpdateState =
      this.bot.constantSkills.getSkill('auto-update-state');
    if (autoUpdateState) {
      await autoUpdateState.run();
    }

    // メッセージ構築
    const systemPrompt = this.buildSystemPrompt();
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
    console.log(
      `\x1b[36m📏 System prompt: ${totalChars}文字 (旧方式: ~23000文字)\x1b[0m`,
    );

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
          console.log(
            '\x1b[31m⏱ FunctionCallingAgent: 総実行時間超過 (5分)\x1b[0m',
          );
          break;
        }

        // ── ユーザーフィードバックを会話に追加 ──
        while (this.pendingFeedback.length > 0) {
          const fb = this.pendingFeedback.shift()!;
          messages.push(
            new HumanMessage(`ユーザーからのフィードバック: ${fb}`),
          );
          console.log(`\x1b[33m📝 フィードバックを会話に追加: ${fb}\x1b[0m`);
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
          console.log(
            `\x1b[32m⏱ LLM応答: ${Date.now() - llmStart}ms (iteration ${iteration + 1})\x1b[0m`,
          );
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
              console.log(
                `\x1b[33m⚠ チャット送信失敗: ${(e as Error).message}\x1b[0m`,
              );
            }
          }

          // 会話的応答（質問を含む）の場合はユーザーの返答を待機
          const isConversational = this.isConversationalResponse(content);
          if (
            isConversational &&
            iteration < FunctionCallingAgent.MAX_ITERATIONS - 1 &&
            !signal?.aborted
          ) {
            console.log(
              `\x1b[36m🔄 会話的応答を検出 - ユーザーの返答を待機中 (最大${FunctionCallingAgent.RESPONSE_TIMEOUT_MS / 1000}秒)...\x1b[0m`,
            );
            console.log(`   応答: ${content.substring(0, 200)}`);

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
              console.log(
                `\x1b[32m📨 ユーザー応答受信: "${userResponse}" (Q&A ${conversationQA.length}件) - 会話を継続\x1b[0m`,
              );
              continue;
            }
            // タイムアウト → タスク完了として処理
            console.log(
              `\x1b[33m⏱ 応答待機タイムアウト - タスクを完了します\x1b[0m`,
            );
          }

          // タスク完了
          console.log(
            `\x1b[32m✅ FunctionCallingAgent: タスク完了 (${iteration + 1}イテレーション, ${((Date.now() - startTime) / 1000).toFixed(1)}s)\x1b[0m`,
          );
          if (content) {
            console.log(`   応答: ${content.substring(0, 200)}`);
          }

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
        console.log(
          `\x1b[36m🔧 ${toolCalls.length}個のツールを実行中...\x1b[0m`,
        );

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
            console.log(`\x1b[31m  ✗ ${errorMsg}\x1b[0m`);

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
            console.log(
              `\x1b[36m  ▶ ${toolCall.name}(${JSON.stringify(toolCall.args)})\x1b[0m`,
            );

            const result = await tool.invoke(toolCall.args);
            const duration = Date.now() - execStart;

            const resultStr =
              typeof result === 'string'
                ? result
                : JSON.stringify(result);
            console.log(
              `\x1b[32m  ✓ ${toolCall.name} (${duration}ms): ${resultStr.substring(0, 200)}\x1b[0m`,
            );

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
            console.log(`\x1b[31m  ✗ ${errorMsg}\x1b[0m`);

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
      console.log(
        `\x1b[33m⚠ FunctionCallingAgent: 最大イテレーション(${FunctionCallingAgent.MAX_ITERATIONS})に到達\x1b[0m`,
      );

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
      console.error(
        `\x1b[31m❌ FunctionCallingAgent error: ${errorMsg}\x1b[0m`,
      );

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
  private buildSystemPrompt(): string {
    const env = this.gatherEnvironmentContext();

    const entity = this.bot.entity as any;
    const health = this.bot.health || 0;
    const food = this.bot.food || 0;
    const pos = entity?.position || { x: 0, y: 0, z: 0 };

    const inventory =
      this.bot.inventory
        .items()
        .map((item: any) => `${item.name}x${item.count}`)
        .join(', ') || 'なし';

    const hand =
      this.bot.inventory.slots[this.bot.quickBarSlot]?.name || 'なし';

    const entitiesStr =
      env.nearbyEntities.length > 0
        ? `\n- 周囲: ${env.nearbyEntities.map((e) => `${e.name}(${e.distance}m)`).join(', ')}`
        : '';

    return `あなたはMinecraftボット「シャノン」です。ツールを使ってユーザーの指示を実行してください。
完了したら必ずchatツールで結果をユーザーに報告してください。
**重要: タスク実行の確認のためにユーザーに聞き返してはいけない。2択・選択を含むタスクでは自分で選んで即行動する。ただし、ゲームやクイズなどユーザーとの対話が目的のタスクでは、質問・会話を積極的に行う。ユーザーの返答は自動的に届く。**

## 現在の状態
- 位置: (${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})
- HP: ${health}/20${health < 8 ? ' ⚠危険' : ''}, 満腹度: ${food}/20
- 手持ち: ${hand}
- インベントリ: ${inventory}
- 環境: ${env.environment.dimension}, ${env.environment.timeOfDay}, ${env.environment.weather}
- 向き: ${env.facing.direction}${entitiesStr}

## ルール
1. **タスク全体を把握してから行動する**。キーワードに反射的に反応せず、何が求められているか全体を理解した上で適切な順序で実行する。判断を求められたら自分で決めて即行動する（ユーザーに聞き返さない）
2. 複雑なタスク（3ステップ以上）はまずupdate-planで計画を立ててから実行する。サブタスクの完了時もupdate-planでステータスを更新する
3. 行動する前にまず状況を確認する（find-blocks, check-inventory等）
4. ブロック/コンテナ操作は近距離(3m以内)で。遠い場合はmove-toで近づく
5. 失敗したら同じことを繰り返さない。2回同じエラーが出たら方針転換
6. 具体的なブロック名を使う（"log"→"oak_log", "planks"→"oak_planks"）
7. stone(石)を掘る→cobblestone(丸石)がドロップ。cobblestoneが欲しい場合はstoneを掘る
8. 木材の種類を合わせる（oak_log→oak_planks, birch_log→birch_planks）
9. 農業: farmlandに種を植える。土をクワで耕すとfarmlandになる`;
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
    }>;
    facing: { direction: string; yaw: number; pitch: number };
  } {
    const botPosition = this.bot.entity?.position;
    const nearbyEntities: Array<{
      name: string;
      type: string;
      distance: number;
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

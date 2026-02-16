import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';
import { createLogger } from '../../../../../utils/logger.js';
import { CentralLogManager, LogManager } from '../logging/index.js';

const log = createLogger('Minebot:Execution');

/**
 * アクション項目の型定義
 */
interface ActionItem {
    toolName: string;
    args: Record<string, any>;
    expectedResult: string;
}

/**
 * 実行結果の型定義
 */
export interface ExecutionResult {
    toolName: string;
    args: Record<string, any>;
    success: boolean;
    message: string;
    duration: number;
    error?: string;
}

/**
 * Execution Node
 * スキル（ツール）を実行する
 * 
 * 特徴:
 * - 並列実行対応 (Promise.allSettled)
 * - 実行時間計測
 * - 詳細なログ記録
 */
export class ExecutionNode {
    private tools: Map<string, StructuredTool>;
    private logManager: LogManager;
    private centralLogManager: CentralLogManager;

    constructor(tools: StructuredTool[], centralLogManager?: CentralLogManager) {
        this.tools = new Map(tools.map((tool) => [tool.name, tool]));
        this.centralLogManager = centralLogManager || CentralLogManager.getInstance();
        this.logManager = this.centralLogManager.getLogManager('execution_node');
    }

    /**
     * ツールのスキーマ情報を取得（エラーメッセージ用）
     */
    private getToolSchemaInfo(tool: StructuredTool): string {
        try {
            const schema = tool.schema;
            if (schema && typeof schema === 'object' && '_def' in schema) {
                const def = (schema as any)._def;
                if (def.typeName === 'ZodObject' && def.shape) {
                    const params = Object.keys(def.shape()).map(key => {
                        const field = def.shape()[key];
                        const desc = field?._def?.description || '';
                        const isNullable = field?._def?.typeName === 'ZodNullable';
                        const required = !isNullable && desc.includes('必須') ? '(必須)' : '(省略可)';
                        return `${key}${required}: ${desc}`;
                    });
                    return params.join(' | ');
                }
            }
            return 'パラメータ情報なし';
        } catch {
            return 'パラメータ情報なし';
        }
    }

    /**
     * 単一アクションを実行（実行時間計測付き）
     */
    private async executeAction(
        action: ActionItem,
        index: number,
        total: number
    ): Promise<{ success: boolean; message: ToolMessage; result: ExecutionResult }> {
        const startTime = Date.now();

        log.info(`[${index + 1}/${total}] ${action.toolName}を実行中...`, 'cyan');

        const tool = this.tools.get(action.toolName);
        if (!tool) {
            const duration = Date.now() - startTime;
            const errorMsg = `ツール ${action.toolName} が見つかりません`;
            log.error(errorMsg);

            return {
                success: false,
                result: {
                    toolName: action.toolName,
                    args: action.args,
                    success: false,
                    message: errorMsg,
                    duration,
                    error: errorMsg,
                },
                message: new ToolMessage({
                    content: errorMsg,
                    tool_call_id: `call_${Date.now()}_${index}`,
                    name: action.toolName,
                }),
            };
        }

        try {
            // _expectedResult などの内部フィールドを除去
            const cleanArgs = { ...action.args };
            delete cleanArgs._expectedResult;
            delete cleanArgs._dynamicResolve;

            log.info(`${action.toolName}を実行します。パラメータ：${JSON.stringify(cleanArgs)}`);

            const result = await tool.invoke(cleanArgs);
            const duration = Date.now() - startTime;

            log.success(`✓ ${action.toolName} 完了 (${duration}ms): ${result}`);

            // 結果が失敗を示している場合もエラーとして扱う
            const isError =
                typeof result === 'string' &&
                (result.includes('失敗') ||
                    result.includes('エラー') ||
                    result.includes('error') ||
                    result.includes('見つかりません'));

            if (isError) {
                log.warn(`⚠ ${action.toolName} の結果が失敗を示しています`);
            }

            const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

            return {
                success: !isError,
                result: {
                    toolName: action.toolName,
                    args: cleanArgs,
                    success: !isError,
                    message: resultStr,
                    duration,
                    error: isError ? resultStr : undefined,
                },
                message: new ToolMessage({
                    content: result,
                    tool_call_id: `call_${Date.now()}_${index}`,
                    name: action.toolName,
                }),
            };
        } catch (error) {
            const duration = Date.now() - startTime;

            // スキーマエラーの場合、スキルの引数情報を表示
            let errorMsg = `${action.toolName} 実行エラー`;

            if (error instanceof Error && error.message.includes('did not match expected schema')) {
                const paramsInfo = this.getToolSchemaInfo(tool);
                // cleanArgsを使用（_expectedResultなどの内部フィールドを除去した状態で表示）
                const cleanArgs = { ...action.args };
                delete cleanArgs._expectedResult;
                delete cleanArgs._dynamicResolve;
                errorMsg = `${action.toolName}の引数が間違っています。` +
                    `提供された引数: ${JSON.stringify(cleanArgs)}。` +
                    `このスキルの引数: ${paramsInfo}`;
            } else {
                errorMsg += `: ${error instanceof Error ? error.message : '不明なエラー'}`;
            }

            log.error(`✗ ${errorMsg} (${duration}ms)`);

            return {
                success: false,
                result: {
                    toolName: action.toolName,
                    args: action.args,
                    success: false,
                    message: errorMsg,
                    duration,
                    error: errorMsg,
                },
                message: new ToolMessage({
                    content: errorMsg,
                    tool_call_id: `call_${Date.now()}_${index}`,
                    name: action.toolName,
                }),
            };
        }
    }

    /**
     * 複数アクションを並列実行
     */
    private async executeActionsInParallel(
        actions: ActionItem[]
    ): Promise<{ results: ExecutionResult[]; messages: ToolMessage[]; hasError: boolean }> {
        const startTime = Date.now();

        const promises = actions.map((action, index) =>
            this.executeAction(action, index, actions.length)
        );

        const settledResults = await Promise.allSettled(promises);

        const results: ExecutionResult[] = [];
        const messages: ToolMessage[] = [];
        let hasError = false;

        for (let i = 0; i < settledResults.length; i++) {
            const settled = settledResults[i];

            if (settled.status === 'fulfilled') {
                results.push(settled.value.result);
                messages.push(settled.value.message);
                if (!settled.value.success) {
                    hasError = true;
                }
            } else {
                // Promise自体が失敗した場合
                const duration = Date.now() - startTime;
                const errorMsg = `${actions[i].toolName} 実行中に例外が発生: ${settled.reason}`;

                results.push({
                    toolName: actions[i].toolName,
                    args: actions[i].args,
                    success: false,
                    message: errorMsg,
                    duration,
                    error: errorMsg,
                });

                messages.push(new ToolMessage({
                    content: errorMsg,
                    tool_call_id: `call_${Date.now()}_${i}`,
                    name: actions[i].toolName,
                }));

                hasError = true;
            }
        }

        return { results, messages, hasError };
    }

    /**
     * メインの実行メソッド
     */
    async invoke(state: any): Promise<any> {
        const messages = state.messages;
        const lastMessage = messages[messages.length - 1];

        if (!(lastMessage instanceof AIMessage)) {
            throw new Error('Last message must be an AIMessage');
        }

        const toolCalls = lastMessage.tool_calls || [];
        if (toolCalls.length === 0) {
            throw new Error('No tool calls found in AIMessage');
        }

        // アクションリストを構築
        const actions: ActionItem[] = toolCalls.map((toolCall: any) => ({
            toolName: toolCall.name,
            args: toolCall.args,
            expectedResult: toolCall.args?._expectedResult || '',
        }));

        // 実行開始ログ
        this.logManager.addLog({
            phase: 'execution',
            level: 'info',
            source: 'execution_node',
            content: `Executing ${actions.length} action(s)...`,
            metadata: {
                actions: actions.map(a => a.toolName),
            },
        });

        // 並列実行判定（現時点では全て順次実行、将来的に並列化可能）
        // 依存関係のないアクションは並列実行可能だが、
        // Minecraftでは順序が重要なことが多いため順次実行をデフォルトに
        const useParallel = false; // 将来的にフラグ化

        let executionResults: ExecutionResult[] = [];
        let toolMessages: ToolMessage[] = [];
        let hasError = false;

        if (useParallel && actions.length > 1) {
            // 並列実行
            const parallelResult = await this.executeActionsInParallel(actions);
            executionResults = parallelResult.results;
            toolMessages = parallelResult.messages;
            hasError = parallelResult.hasError;
        } else {
            // 順次実行（エラーで中断）
            for (let i = 0; i < actions.length; i++) {
                const { success, message, result } = await this.executeAction(
                    actions[i],
                    i,
                    actions.length
                );

                executionResults.push(result);
                toolMessages.push(message);

                // ログに記録
                this.logManager.addLog({
                    phase: 'execution',
                    level: success ? 'success' : 'error',
                    source: actions[i].toolName,
                    content: result.message,
                    metadata: {
                        toolName: actions[i].toolName,
                        parameters: result.args,
                        duration: result.duration,
                        error: result.error,
                    },
                });

                if (!success) {
                    hasError = true;
                    // 残りのアクションをスキップ
                    if (i < actions.length - 1) {
                        log.warn(`残り${actions.length - i - 1}個のアクションをスキップしました`);
                    }
                    break;
                }
            }
        }

        // 実行サマリーログ
        const successCount = executionResults.filter(r => r.success).length;
        const totalDuration = executionResults.reduce((sum, r) => sum + r.duration, 0);

        this.logManager.addLog({
            phase: 'execution',
            level: hasError ? 'warning' : 'success',
            source: 'execution_node',
            content: `Execution ${hasError ? 'completed with errors' : 'completed'}: ${successCount}/${executionResults.length} succeeded (${totalDuration}ms total)`,
            metadata: {
                successCount,
                totalCount: executionResults.length,
                totalDuration,
                hasError,
            },
        });

        // ログをUIに送信
        await this.centralLogManager.sendNewLogsToUI();

        return {
            messages: toolMessages,
            lastToolResult: executionResults.length > 0
                ? executionResults[executionResults.length - 1].message
                : '',
            hasError,
            // PlanningNodeに渡す実行結果
            executionResults,
        };
    }

    /**
     * ログを取得
     */
    getLogs() {
        return this.logManager.getLogs();
    }

    /**
     * ログをクリア
     */
    clearLogs() {
        this.logManager.clearLogs();
    }
}

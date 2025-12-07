import { ToolMessage } from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';
import { EventBus } from '../../../eventBus/eventBus.js';
import { getEventBus } from '../../../eventBus/index.js';
import { ExecutionResult } from '../types.js';

/**
 * アクション項目の型定義
 */
interface ActionItem {
    toolName: string;
    args: Record<string, any>;
    expectedResult: string;
}

/**
 * Execution Node: ツール実行
 * 
 * 特徴:
 * - 順次実行（エラーで中断）
 * - 実行時間計測
 * - 詳細なログ記録
 * - EventBus経由でログ送信
 */
export class ExecutionNode {
    private tools: Map<string, StructuredTool>;
    private eventBus: EventBus;

    constructor(tools: StructuredTool[]) {
        this.tools = new Map(tools.map((tool) => [tool.name, tool]));
        this.eventBus = getEventBus();
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
                        const required = !isNullable ? '(必須)' : '(省略可)';
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

        console.log(
            `\x1b[36m[${index + 1}/${total}] ${action.toolName}を実行中...\x1b[0m`
        );

        const tool = this.tools.get(action.toolName);
        if (!tool) {
            const duration = Date.now() - startTime;
            const errorMsg = `ツール ${action.toolName} が見つかりません`;
            console.error(`\x1b[31m${errorMsg}\x1b[0m`);

            // EventBusでログを送信
            this.eventBus.log('web', 'red', `❌ ${errorMsg}`, false);

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

            console.log(`${action.toolName}を実行します。パラメータ：${JSON.stringify(cleanArgs)}`);

            const result = await tool.invoke(cleanArgs);
            const duration = Date.now() - startTime;

            console.log(`\x1b[32m✓ ${action.toolName} 完了 (${duration}ms): ${result}\x1b[0m`);

            // 結果が失敗を示している場合もエラーとして扱う
            const isError =
                typeof result === 'string' &&
                (result.includes('失敗') ||
                    result.includes('エラー') ||
                    result.includes('error') ||
                    result.includes('見つかりません'));

            if (isError) {
                console.warn(
                    `\x1b[33m⚠ ${action.toolName} の結果が失敗を示しています\x1b[0m`
                );
            }

            const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

            // EventBusでログを送信
            this.eventBus.log(
                'web',
                isError ? 'yellow' : 'green',
                `${isError ? '⚠' : '✓'} ${action.toolName}: ${resultStr.substring(0, 100)}${resultStr.length > 100 ? '...' : ''}`,
                false
            );

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
                const cleanArgs = { ...action.args };
                delete cleanArgs._expectedResult;
                delete cleanArgs._dynamicResolve;
                errorMsg = `${action.toolName}の引数が間違っています。` +
                    `提供された引数: ${JSON.stringify(cleanArgs)}。` +
                    `このスキルの引数: ${paramsInfo}`;
            } else {
                errorMsg += `: ${error instanceof Error ? error.message : '不明なエラー'}`;
            }

            console.error(`\x1b[31m✗ ${errorMsg} (${duration}ms)\x1b[0m`);

            // EventBusでログを送信
            this.eventBus.log('web', 'red', `❌ ${errorMsg}`, false);

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
     * メインの実行メソッド
     */
    async invoke(state: any): Promise<any> {
        // nextActionSequence または actionSequence を取得
        const activeActionSequence = state.taskTree?.nextActionSequence || state.taskTree?.actionSequence;

        // アクションがない場合はそのまま返す
        if (!activeActionSequence || activeActionSequence.length === 0) {
            console.log('\x1b[33m⚠ 実行するアクションがありません\x1b[0m');
            return {
                ...state,
                executionResults: [],
                hasError: false,
            };
        }

        // アクションリストを構築
        const actions: ActionItem[] = activeActionSequence.map((action: any) => ({
            toolName: action.toolName,
            args: action.args || {},
            expectedResult: action.expectedResult || '',
        }));

        console.log(`\x1b[36m⚡ ${actions.length}個のアクションを実行開始...\x1b[0m`);

        let executionResults: ExecutionResult[] = [];
        let toolMessages: ToolMessage[] = [];
        let hasError = false;

        // 順次実行（エラーで中断）
        for (let i = 0; i < actions.length; i++) {
            const { success, message, result } = await this.executeAction(
                actions[i],
                i,
                actions.length
            );

            executionResults.push(result);
            toolMessages.push(message);

            if (!success) {
                hasError = true;
                // 残りのアクションをスキップ
                if (i < actions.length - 1) {
                    console.log(`\x1b[33m残り${actions.length - i - 1}個のアクションをスキップしました\x1b[0m`);
                }
                break;
            }
        }

        // 実行サマリーログ
        const successCount = executionResults.filter(r => r.success).length;
        const totalDuration = executionResults.reduce((sum, r) => sum + r.duration, 0);

        console.log(
            `\x1b[36m📊 実行完了: ${successCount}/${executionResults.length} 成功 (${totalDuration}ms)\x1b[0m`
        );

        // EventBusでサマリーログを送信
        this.eventBus.log(
            'web',
            hasError ? 'yellow' : 'cyan',
            `📊 実行完了: ${successCount}/${executionResults.length} 成功 (${totalDuration}ms)`,
            false
        );

        return {
            messages: toolMessages,
            lastToolResult: executionResults.length > 0
                ? executionResults[executionResults.length - 1].message
                : '',
            hasError,
            executionResults,
        };
    }
}


import { AIMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { CustomBot, InstantSkill } from '../../../types.js';
import { CentralLogManager, DetailedLog, LogManager } from '../logging/index.js';

/**
 * Execution Node
 * 方法1（Tool Calling）+ 方法3（Thinking）のハイブリッド実装
 * 旧名: EnhancedExecutionNode
 */
export class ExecutionNode {
    private bot: CustomBot;
    private llm: ChatOpenAI;
    private logManager: LogManager;
    private centralLogManager: CentralLogManager;

    constructor(bot: CustomBot, centralLogManager?: CentralLogManager) {
        this.bot = bot;
        this.llm = new ChatOpenAI({
            modelName: 'gpt-4o',
            temperature: 0.1,
            streaming: false,
        });
        this.centralLogManager = centralLogManager || CentralLogManager.getInstance();
        this.logManager = this.centralLogManager.getLogManager('execution_node');
    }

    async invoke(state: any): Promise<any> {
        console.log('🔧 EnhancedExecutionNode: 実行開始...');

        // 現在実行中のサブタスクを取得
        const currentSubTask = state.subTasks.find(
            (task: any) => task.subTaskStatus === 'in_progress'
        );

        if (!currentSubTask) {
            console.log('⚠️ 実行中のサブタスクがありません');
            return state;
        }

        try {
            // === Phase 1: Thinking（思考フェーズ）===
            const thinking = await this.thinkAboutExecution(currentSubTask, state);

            this.logManager.addLog({
                phase: 'thinking',
                level: 'info',
                source: 'execution_node',
                content: thinking,
            });

            // === Phase 2: Tool Selection（ツール選択）===
            const tools = this.buildToolDefinitions();
            const toolSelectionResult = await this.selectTools(
                currentSubTask,
                thinking,
                state,
                tools
            );

            // ツール呼び出しをログに記録
            for (const call of toolSelectionResult.toolCalls) {
                this.logManager.addLog({
                    phase: 'tool_call',
                    level: 'info',
                    source: call.name,
                    content: `Executing ${call.name}`,
                    metadata: {
                        toolName: call.name,
                        parameters: call.args,
                    },
                });
            }

            // === Phase 3: Parallel Execution（並列実行）===
            const results = await this.executeToolsInParallel(toolSelectionResult.toolCalls);

            // 結果をログに記録
            results.forEach((result, i) => {
                this.logManager.addLog({
                    phase: 'tool_result',
                    level: result.success ? 'success' : 'error',
                    source: toolSelectionResult.toolCalls[i].name,
                    content: result.message,
                    metadata: {
                        toolName: toolSelectionResult.toolCalls[i].name,
                        result: result.data,
                        duration: result.duration,
                        error: result.error,
                    },
                });
            });

            // === Phase 4: Quick Reflection（簡易反省）===
            const reflection = await this.quickReflect(currentSubTask, results);

            this.logManager.addLog({
                phase: 'reflection',
                level: reflection.hasErrors ? 'warning' : 'success',
                source: 'execution_node',
                content: reflection.summary,
                metadata: {
                    shouldContinue: reflection.shouldContinue,
                    hasErrors: reflection.hasErrors,
                },
            });

            // === UIにログを送信 ===
            await this.centralLogManager.sendNewLogsToUI();

            // サブタスクの結果を更新
            const updatedSubTasks = state.subTasks.map((task: any) => {
                if (task === currentSubTask) {
                    return {
                        ...task,
                        subTaskResult: reflection.summary,
                        subTaskStatus: reflection.hasErrors ? 'error' : 'completed',
                    };
                }
                return task;
            });

            return {
                ...state,
                subTasks: updatedSubTasks,
                messages: [
                    ...state.messages,
                    new AIMessage(`Execution result: ${reflection.summary}`),
                ],
            };
        } catch (error: any) {
            console.error('❌ EnhancedExecutionNode エラー:', error);

            this.logManager.addLog({
                phase: 'tool_result',
                level: 'error',
                source: 'execution_node',
                content: `Execution failed: ${error.message}`,
                metadata: {
                    error: error.message,
                    stack: error.stack,
                },
            });

            await this.centralLogManager.sendNewLogsToUI();

            return {
                ...state,
                error: `Execution failed: ${error.message}`,
                subTasks: state.subTasks.map((task: any) => {
                    if (task === currentSubTask) {
                        return {
                            ...task,
                            subTaskStatus: 'error',
                            subTaskResult: `Error: ${error.message}`,
                        };
                    }
                    return task;
                }),
            };
        }
    }

    /**
     * Phase 1: 思考フェーズ
     */
    private async thinkAboutExecution(
        subTask: any,
        state: any
    ): Promise<string> {
        const prompt = `あなたはMinecraftボットです。

現在のサブタスク: ${subTask.subTaskGoal}
サブタスク戦略: ${subTask.subTaskStrategy}

現在の状況:
- 位置: ${JSON.stringify(this.bot.entity?.position)}
- HP: ${this.bot.health}/20
- 満腹度: ${this.bot.food}/20
- インベントリ: ${JSON.stringify(this.bot.inventory.items().slice(0, 5))}
- 周辺環境: ${JSON.stringify(state.environmentContext || 'unknown')}

このサブタスクを達成するための実行戦略を考えてください:
1. 何を目指すか？
2. どんな順序で実行するか？
3. 並列実行できるアクションは何か？
4. 注意すべきポイントは？

簡潔に（3-5行で）答えてください。`;

        const response = await this.llm.invoke([new SystemMessage(prompt)]);
        return response.content as string;
    }

    /**
     * Phase 2: ツール選択（Tool Calling）
     */
    private async selectTools(
        subTask: any,
        thinking: string,
        state: any,
        tools: any[]
    ): Promise<{ toolCalls: any[] }> {
        const prompt = `戦略: ${thinking}

現在のサブタスク: ${subTask.subTaskGoal}

以下のツールを使って実行してください。
並列実行できるものは全て列挙してください。

実行後は簡単に結果を報告してください。`;

        const response = await this.llm.invoke([new SystemMessage(prompt)], {
            tools,
            tool_choice: 'auto',
        });

        const toolCalls = response.tool_calls || [];
        return { toolCalls };
    }

    /**
     * Phase 3: 並列実行
     */
    private async executeToolsInParallel(
        toolCalls: any[]
    ): Promise<Array<{
        success: boolean;
        message: string;
        data?: any;
        duration?: number;
        error?: string;
    }>> {
        const results = await Promise.allSettled(
            toolCalls.map(call => this.executeToolCall(call))
        );

        return results.map(result => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                return {
                    success: false,
                    message: `Error: ${result.reason}`,
                    error: result.reason,
                };
            }
        });
    }

    /**
     * 個別のツール（スキル）実行
     */
    private async executeToolCall(call: any): Promise<{
        success: boolean;
        message: string;
        data?: any;
        duration?: number;
        error?: string;
    }> {
        const startTime = Date.now();

        const skill = this.bot.instantSkills.getSkill(call.name);
        if (!skill) {
            throw new Error(`Skill ${call.name} not found`);
        }

        console.log(
            `\x1b[32m🔧 Executing: ${call.name} with params: ${JSON.stringify(call.args)}\x1b[0m`
        );

        try {
            // スキル実行
            const result = await skill.run(...Object.values(call.args));
            const duration = Date.now() - startTime;

            console.log(
                `\x1b[32m✅ ${call.name} completed in ${duration}ms: ${result.result}\x1b[0m`
            );

            return {
                success: result.success,
                message: result.result,
                data: result,
                duration,
            };
        } catch (error: any) {
            const duration = Date.now() - startTime;
            console.error(`\x1b[31m❌ ${call.name} failed: ${error.message}\x1b[0m`);

            return {
                success: false,
                message: `Error: ${error.message}`,
                error: error.message,
                duration,
            };
        }
    }

    /**
     * Phase 4: 簡易反省
     */
    private async quickReflect(
        subTask: any,
        results: any[]
    ): Promise<{
        summary: string;
        shouldContinue: boolean;
        hasErrors: boolean;
    }> {
        const hasErrors = results.some(r => !r.success);
        const successCount = results.filter(r => r.success).length;
        const totalCount = results.length;

        const summary = hasErrors
            ? `${successCount}/${totalCount} actions succeeded. Some errors occurred.`
            : `All ${totalCount} actions completed successfully.`;

        return {
            summary,
            shouldContinue: !hasErrors,
            hasErrors,
        };
    }

    /**
     * ツール定義を構築（既存のスキルから）
     */
    private buildToolDefinitions(): any[] {
        return this.bot.instantSkills
            .getSkills()
            .filter((skill: InstantSkill) => skill.isToolForLLM)
            .map((skill: InstantSkill) => {
                // パラメータ定義を構築
                const properties: any = {};
                const required: string[] = [];

                skill.params.forEach((param: any) => {
                    let type = 'string';
                    switch (param.type) {
                        case 'number':
                            type = 'number';
                            break;
                        case 'boolean':
                            type = 'boolean';
                            break;
                        case 'Vec3':
                            properties[param.name] = {
                                type: 'object',
                                description: param.description,
                                properties: {
                                    x: { type: 'number' },
                                    y: { type: 'number' },
                                    z: { type: 'number' },
                                },
                                required: ['x', 'y', 'z'],
                            };
                            required.push(param.name);
                            return;
                    }

                    properties[param.name] = {
                        type,
                        description: param.description,
                    };

                    if (!param.default) {
                        required.push(param.name);
                    }
                });

                return {
                    type: 'function',
                    function: {
                        name: skill.skillName,
                        description: skill.description,
                        parameters: {
                            type: 'object',
                            properties,
                            required,
                        },
                    },
                };
            });
    }

    /**
     * ログをクリア
     */
    clearLogs(): void {
        this.logManager.clearLogs();
    }

    /**
     * ログを取得
     */
    getLogs(): DetailedLog[] {
        return this.logManager.getLogs();
    }
}


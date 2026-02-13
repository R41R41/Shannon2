import { ChatOpenAI } from '@langchain/openai';
import { TaskTreeState } from '@shannon/common';
import { z } from 'zod';
import { EventBus } from '../../../eventBus/eventBus.js';
import { getEventBus } from '../../../eventBus/index.js';
import { Prompt } from '../prompt.js';

/**
 * Planning Node: 戦略立案とタスク計画
 * 
 * - 階層的サブタスクによる複雑なタスク管理
 * - 次に実行するアクションの引数を完全に指定
 * - エラー時の再計画対応
 */
export class PlanningNode {
    private model: ChatOpenAI;
    private prompt: Prompt;
    private eventBus: EventBus;
    private subTaskIdCounter: number = 0;

    constructor(prompt: Prompt) {
        this.prompt = prompt;
        this.eventBus = getEventBus();

        // gpt-5.2を使用（高精度 & Structured Outputs対応）
        this.model = new ChatOpenAI({
            modelName: 'gpt-5.2',
            apiKey: process.env.OPENAI_API_KEY!,
            temperature: 0,
        });
    }

    /**
     * ユニークなサブタスクIDを生成
     */
    private generateSubTaskId(): string {
        return `st_${++this.subTaskIdCounter}`;
    }

    /**
     * 計画を立案する
     */
    async invoke(state: any): Promise<any> {
        console.log('🧠 PlanningNode: 戦略を立案中...');

        // 前回の実行結果があればログに表示
        if (state.executionResults) {
            const results = state.executionResults;
            const successCount = results.filter((r: any) => r.success).length;
            const totalCount = results.length;
            console.log(`\x1b[36m📊 前回の実行結果: ${successCount}/${totalCount} 成功\x1b[0m`);
            if (results.some((r: any) => !r.success)) {
                const errors = results.filter((r: any) => !r.success);
                errors.forEach((e: any) => {
                    console.log(`\x1b[31m   ✗ ${e.toolName}: ${e.message}\x1b[0m`);
                });
            }
        }

        // === 階層的サブタスク（表示用・自然言語） ===
        const HierarchicalSubTaskSchema: z.ZodType<any> = z.lazy(() => z.object({
            id: z.string().describe('サブタスクID'),
            goal: z.string().describe('やること（自然言語）'),
            status: z.enum(['pending', 'in_progress', 'completed', 'error']).describe('ステータス'),
            result: z.string().nullable().optional().describe('結果（完了時）'),
            failureReason: z.string().nullable().optional().describe('エラー理由（失敗時）'),
            children: z.array(HierarchicalSubTaskSchema).nullable().optional().describe('子タスク（階層的）'),
        }));

        // === 次に実行するアクション（実行用・引数完全指定） ===
        const ActionItemSchema = z.object({
            toolName: z.string().describe('実行するツール名'),
            args: z.string().describe(
                '引数のJSON文字列。全ての引数を完全に指定すること。' +
                '例: \'{"message": "こんにちは", "channelId": "123456789"}\''
            ),
            expectedResult: z.string().describe('期待される結果'),
        });

        // Planning用のスキーマ定義
        const PlanningSchema = z.object({
            status: z.enum(['pending', 'in_progress', 'completed', 'error']),
            goal: z.string().describe('最終目標'),
            strategy: z.string().describe('達成するための戦略（一文で）'),

            // === 表示用: タスクの全体像（階層的・自然言語） ===
            hierarchicalSubTasks: z.array(HierarchicalSubTaskSchema).nullable().describe(
                'タスクの全体像を階層的に表現。各サブタスクは自然言語で「やること」を記述。' +
                '子タスクを持つことで階層構造を表現できる。'
            ),

            // 現在実行中のサブタスクID
            currentSubTaskId: z.string().nullable().describe('現在実行中のサブタスクのID'),

            // === 実行用: 次に実行するスキル（引数完全指定） ===
            nextActionSequence: z.array(ActionItemSchema).nullable().describe(
                '次に実行するスキルのリスト。引数は全て完全に指定すること。' +
                '前のステップの結果に依存するスキルは含めない（結果を見てから次のPlanningで指定）。' +
                '**chat-on-webまたはchat-on-discordを使用してユーザーに結果を送信するまでstatusをcompletedにしないでください。**'
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

        try {
            const messages = this.prompt.getMessages(state, 'planning', true, true);
            const response = await structuredLLM.invoke(messages);

            // 詳細なプランニング結果をログ出力
            console.log('\x1b[36m═══════════════════════════════════════════════════════════════\x1b[0m');
            console.log('\x1b[36m📋 Planning結果\x1b[0m');
            console.log('\x1b[36m═══════════════════════════════════════════════════════════════\x1b[0m');
            console.log(`\x1b[33m🎯 Goal:\x1b[0m ${response.goal}`);
            console.log(`\x1b[33m📝 Strategy:\x1b[0m ${response.strategy}`);
            console.log(`\x1b[33m📊 Status:\x1b[0m ${response.status}`);

            // === 1. 階層的サブタスク（表示用）を表示 ===
            if (response.hierarchicalSubTasks && response.hierarchicalSubTasks.length > 0) {
                console.log(`\x1b[32m📌 HierarchicalSubTasks (タスク全体像):\x1b[0m`);
                this.printHierarchicalSubTasks(response.hierarchicalSubTasks, 0);
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
            console.log('\x1b[36m═══════════════════════════════════════════════════════════════\x1b[0m');

            // EventBus経由でUIに通知
            this.eventBus.publish({
                type: 'web:planning',
                memoryZone: 'web',
                data: {
                    goal: response.goal,
                    strategy: response.strategy,
                    status: response.status,
                    hierarchicalSubTasks: response.hierarchicalSubTasks,
                    subTasks: response.subTasks,
                },
                targetMemoryZones: ['web'],
            });

            // Discord channelIdがあればDiscordにも通知
            if (state.channelId) {
                this.eventBus.publish({
                    type: 'discord:planning',
                    memoryZone: state.memoryZone || 'web',
                    data: {
                        planning: {
                            goal: response.goal,
                            strategy: response.strategy,
                            status: response.status,
                            subTasks: response.subTasks,
                        },
                        channelId: state.channelId,
                        taskId: state.taskId,
                    },
                });
            }

            // nextActionSequenceをパース（無効なargsはスキップ）
            const parsedNextActionSequence = response.nextActionSequence?.map(a => {
                let argsStr = a.args?.trim() || '';

                // 完全に無効なケース
                if (!argsStr || argsStr === 'null' || argsStr.startsWith(':')) {
                    console.log(`\x1b[33m⚠ ${a.toolName}: 無効なargs "${a.args}" → スキップ\x1b[0m`);
                    return null;
                }

                // シングルクォートをダブルクォートに変換
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
                    console.log(`\x1b[33m⚠ ${a.toolName}: argsのパースに失敗 "${a.args}" → スキップ\x1b[0m`);
                    return null;
                }
            }).filter(a => a !== null) || null;

            return {
                taskTree: {
                    status: response.status,
                    goal: response.goal,
                    strategy: response.strategy,
                    hierarchicalSubTasks: response.hierarchicalSubTasks || null,
                    currentSubTaskId: response.currentSubTaskId || null,
                    nextActionSequence: parsedNextActionSequence,
                    actionSequence: parsedNextActionSequence,
                    subTasks: response.subTasks,
                } as TaskTreeState,
            };
        } catch (error) {
            console.error('❌ PlanningNode error:', error);

            return {
                taskTree: {
                    status: 'error',
                    goal: `エラー: ${error instanceof Error ? error.message : '不明なエラー'}`,
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

        tasks.forEach((task) => {
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
}


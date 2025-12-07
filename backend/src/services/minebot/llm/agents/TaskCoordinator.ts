/**
 * TaskCoordinator
 * タスクのライフサイクル管理を担当
 * CentralAgentから分離
 */

import { BaseMessage } from '@langchain/core/messages';
import { CustomBot } from '../../types.js';
import { LLMError } from '../../types/index.js';
import { errorHandler } from '../../utils/ErrorHandler.js';
import { TaskGraph } from '../graph/taskGraph.js';
import { ActionJudge } from './ActionJudge.js';
import { TaskAction } from './IActionJudge.js';

/**
 * TaskCoordinator
 * タスクの作成、フィードバック、停止を調整
 */
export class TaskCoordinator {
    private bot: CustomBot;
    private taskGraph: TaskGraph | null = null;
    private actionJudge: ActionJudge;

    constructor(bot: CustomBot) {
        this.bot = bot;
        this.actionJudge = new ActionJudge();
    }

    /**
     * 初期化
     */
    async initialize(): Promise<void> {
        this.taskGraph = TaskGraph.getInstance();
        if (this.taskGraph) {
            await this.taskGraph.initialize(this.bot);
            // 緊急状態解除ハンドラーを設定
            this.taskGraph.setEmergencyResolvedHandler(async () => {
                await this.handleEmergencyResolved();
            });
        }

        console.log('✅ TaskCoordinator initialized');
    }

    /**
     * BotEventHandlerに渡す緊急イベントハンドラーを取得
     */
    public getEmergencyHandler(): (type: string, data: any) => Promise<void> {
        return async (type: string, data: any) => {
            await this.handleEmergencyEvent(type, data);
        };
    }

    /**
     * 緊急事態を処理（BotEventHandlerから直接呼ばれる）
     */
    public async handleEmergencyEvent(type: string, data: any): Promise<void> {
        console.log(`\x1b[35m🚨 緊急イベント受信: ${type}\x1b[0m`);

        const emergencyMessage = this.buildEmergencyMessage(type, data);
        await this.handleEmergency(emergencyMessage, type);
    }

    /**
     * 緊急状態解除（TaskGraphから呼ばれる）
     */
    public async handleEmergencyResolved(): Promise<void> {
        console.log('\x1b[32m✅ 緊急状態が解除されました\x1b[0m');

        // 元のタスクに戻る
        if (this.taskGraph) {
            await this.taskGraph.resumePreviousTask();
        }
    }

    /**
     * 緊急メッセージを生成
     */
    private buildEmergencyMessage(type: string, data: any): string {
        switch (type) {
            case 'damage': {
                const maxHealth = 20;
                const healthPercent = (data.currentHealth / maxHealth) * 100;
                const severity = healthPercent < 40 ? '【危機的】' : '【緊急】';
                return `🚨 ${severity} ダメージ -${data.damage.toFixed(1)}HP (HP: ${healthPercent.toFixed(0)}%)
1. list-nearby-entitiesで敵モブ確認
2. 敵がいればflee-from、いなければ食事で回復
3. HP>50%で敵がいなければ完了(emergencyResolved: true)`;
            }
            case 'suffocation': {
                const oxygenPercent = (data.oxygen / 300) * 100;
                const situation = data.isInWater ? '水中で溺れています' : 'ブロックに埋まっています';
                return `🚨 【緊急】 ${situation}！
- 酸素レベル: ${data.oxygen}/300 (${oxygenPercent.toFixed(0)}%)
- 現在のHP: ${data.health}/20

即座に対応してください。
（水中なら水面へ、埋まっているなら周囲のブロックを破壊）`;
            }
            default:
                return '🚨 緊急事態が発生しました';
        }
    }

    /**
     * 緊急事態を処理（キュー管理対応）
     */
    private async handleEmergency(message: string, type: string): Promise<void> {
        if (!this.taskGraph) {
            console.warn('⚠️ TaskGraphが初期化されていません');
            return;
        }

        // 現在のタスクを中断（paused状態に）
        this.taskGraph.interruptForEmergency(message);

        // 緊急タスクを設定
        const emergencyTaskInput = {
            userMessage: message,
            isEmergency: true,
            emergencyType: type,
        };
        this.taskGraph.setEmergencyTask(emergencyTaskInput);

        // 緊急対応タスクを実行
        await this.taskGraph.invoke(emergencyTaskInput);
    }

    /**
     * プレイヤーメッセージを処理
     */
    async handlePlayerMessage(
        userName: string,
        message: string,
        environmentState?: string,
        selfState?: string,
        recentMessages?: BaseMessage[]
    ): Promise<void> {
        try {
            // アクションを判定
            const action = await this.determineAction(message, recentMessages || []);

            // アクションに応じて処理
            await this.executeAction(action, {
                userName,
                message,
                environmentState,
                selfState,
                recentMessages,
            });
        } catch (error) {
            const llmError = new LLMError('message-processing', error as Error);
            errorHandler.handle(llmError);
            this.bot.chat('エラーが発生しました。もう一度お試しください。');
        }
    }

    /**
     * アクションを判定
     */
    private async determineAction(
        message: string,
        recentMessages: BaseMessage[]
    ): Promise<TaskAction> {
        // タスクが実行中の場合のみアクション判定
        if (this.isTaskInProgress()) {
            const currentContext = this.taskGraph?.currentState?.taskTree;
            const result = await this.actionJudge.judge(message, recentMessages, currentContext);
            return result.action;
        }

        // タスクが実行中でない場合は新しいタスクとして扱う
        return 'new_task';
    }

    /**
     * アクションを実行
     */
    private async executeAction(
        action: TaskAction,
        context: {
            userName: string;
            message: string;
            environmentState?: string;
            selfState?: string;
            recentMessages?: BaseMessage[];
        }
    ): Promise<void> {
        switch (action) {
            case 'new_task':
                await this.createNewTask(context);
                break;
            case 'feedback':
                this.provideFeedback(context.message);
                break;
            case 'stop':
                this.stopTask();
                break;
        }
    }

    /**
     * 新しいタスクを作成（キュー管理対応）
     */
    private async createNewTask(context: {
        userName: string;
        message: string;
        environmentState?: string;
        selfState?: string;
        recentMessages?: BaseMessage[];
    }): Promise<void> {
        console.log('\x1b[31m新しいタスクを作成します\x1b[0m');

        // TaskGraphの初期化確認
        if (!this.taskGraph) {
            this.taskGraph = TaskGraph.getInstance();
            await this.taskGraph.initialize(this.bot);
        }

        // タスクをキューに追加
        const result = this.taskGraph.addTaskToQueue({
            messages: context.recentMessages,
            userMessage: context.message,
            environmentState: context.environmentState,
            selfState: context.selfState,
            taskTree: {
                goal: context.message,
                status: 'pending',
                strategy: '',
            },
        });

        // キューがいっぱいの場合はタスク一覧を表示してどれを終了させるか聞く
        if (!result.success) {
            console.log('\x1b[33m⚠️ タスクキューがいっぱいです\x1b[0m');
            const taskList = this.taskGraph.getTaskListState();
            const taskNames = taskList.tasks.map((t, i) => `${i + 1}. ${t.goal.substring(0, 20)}...`).join('\n');
            this.bot.chat(`今は3つのタスクを抱えています。どれかをやめてほしいですか？\n${taskNames}`);
        }
    }

    /**
     * フィードバックを提供
     */
    private provideFeedback(message: string): void {
        console.log('\x1b[31mフィードバックを更新します\x1b[0m');

        if (!this.taskGraph) {
            console.warn('⚠️ TaskGraphが初期化されていません');
            return;
        }

        this.taskGraph.updateHumanFeedback(message);
    }

    /**
     * タスクを停止（実行中のタスクのみ。キューは残る）
     */
    private stopTask(): void {
        console.log('\x1b[31mタスクを終了します\x1b[0m');

        if (!this.taskGraph) {
            console.warn('⚠️ TaskGraphが初期化されていません');
            return;
        }

        // 実行中のタスクを取得して削除
        const taskList = this.taskGraph.getTaskListState();
        const executingTask = taskList.tasks.find(t => t.status === 'executing');

        if (executingTask) {
            this.taskGraph.removeTask(executingTask.id);
            this.bot.chat('わかりました、やめますね。');
        } else if (taskList.emergencyTask) {
            // 緊急タスク実行中の場合
            this.taskGraph.removeTask(taskList.emergencyTask.id);
            this.bot.chat('緊急対応をやめました。');
        } else {
            this.bot.chat('今は何もしていませんよ。');
        }
    }

    /**
     * タスクが実行中かチェック（キューに実行中のタスクがあるか）
     */
    private isTaskInProgress(): boolean {
        if (!this.taskGraph) return false;

        // キューに実行中のタスクがあるか、または緊急タスクがあるか
        const taskList = this.taskGraph.getTaskListState();
        const hasExecutingTask = taskList.tasks.some(t => t.status === 'executing');
        const hasEmergencyTask = taskList.emergencyTask !== null;

        return hasExecutingTask || hasEmergencyTask || this.taskGraph.isRunning();
    }

    /**
     * 現在のTaskGraphを取得
     */
    getTaskGraph(): TaskGraph | null {
        return this.taskGraph;
    }
}


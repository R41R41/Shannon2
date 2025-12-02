import { AIMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { CustomBot } from '../../../types.js';
import { CentralLogManager, LogManager } from '../logging/index.js';

/**
 * Reflection Node
 * 実行結果を評価し、次のアクションを決定する
 */
export class ReflectionNode {
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
        this.logManager = this.centralLogManager.getLogManager('reflection_node');
    }

    async invoke(state: any): Promise<any> {
        console.log('🤔 ReflectionNode: 結果を評価中...');

        try {
            const reflection = await this.reflectOnResults(state);

            this.logManager.addLog({
                phase: 'reflection',
                level: reflection.overallSuccess ? 'success' : 'warning',
                source: 'reflection_node',
                content: reflection.summary,
                metadata: {
                    shouldReplan: reflection.shouldReplan,
                    shouldRetry: reflection.shouldRetry,
                    isGoalAchieved: reflection.isGoalAchieved,
                    recommendations: reflection.recommendations,
                },
            });

            console.log('✅ Reflection完了:', reflection.decision);

            return {
                ...state,
                reflection,
                shouldReplan: reflection.shouldReplan,
                shouldRetry: reflection.shouldRetry,
                isGoalAchieved: reflection.isGoalAchieved,
                messages: [
                    ...state.messages,
                    new AIMessage(`Reflection: ${reflection.summary}`),
                ],
            };
        } catch (error: any) {
            console.error('❌ ReflectionNode エラー:', error);

            this.logManager.addLog({
                phase: 'reflection',
                level: 'error',
                source: 'reflection_node',
                content: `Reflection failed: ${error.message}`,
                metadata: {
                    error: error.message,
                },
            });

            return {
                ...state,
                error: `Reflection failed: ${error.message}`,
                shouldReplan: true, // エラー時は再計画
            };
        }
    }

    /**
     * 実行結果を評価
     */
    private async reflectOnResults(state: any): Promise<{
        summary: string;
        overallSuccess: boolean;
        isGoalAchieved: boolean;
        shouldReplan: boolean;
        shouldRetry: boolean;
        decision: 'continue' | 'replan' | 'retry' | 'done';
        recommendations: string[];
        failureReasons: string[];
    }> {
        // サブタスクの状態を集計
        const completedTasks = state.subTasks?.filter(
            (task: any) => task.subTaskStatus === 'completed'
        ).length || 0;
        const errorTasks = state.subTasks?.filter(
            (task: any) => task.subTaskStatus === 'error'
        ).length || 0;
        const totalTasks = state.subTasks?.length || 0;

        // 最新のサブタスク結果を取得
        const recentResults = state.subTasks
            ?.map((task: any) => `${task.subTaskGoal}: ${task.subTaskResult || 'No result'}`)
            .join('\n') || 'No tasks';

        // LLMに評価させる
        const prompt = `あなたはMinecraftボットです。タスク実行結果を評価してください。

元のゴール: ${state.goal}
計画: ${state.strategy || 'No strategy'}

実行結果:
- 完了: ${completedTasks}/${totalTasks} タスク
- エラー: ${errorTasks}/${totalTasks} タスク

各サブタスクの結果:
${recentResults}

現在の状態:
- 位置: ${JSON.stringify(this.bot.entity?.position)}
- HP: ${this.bot.health}/20
- インベントリ: ${JSON.stringify(this.bot.inventory.items().slice(0, 5))}

以下を評価してください:
1. ゴールは達成されましたか？ (true/false)
2. 全体的に成功しましたか？ (true/false)
3. 失敗した場合、原因は？
   - 計画が悪い → shouldReplan: true
   - 実行が悪い（一時的なエラー）→ shouldRetry: true
   - 環境が変わった → shouldReplan: true
4. 成功した場合、次のステップは？
   - 完全に完了 → done
   - まだ続きがある → continue
5. 改善のための推奨事項（3-5個）

JSON形式で返してください:
{
  "summary": "評価の要約（2-3文）",
  "overallSuccess": true/false,
  "isGoalAchieved": true/false,
  "shouldReplan": true/false,
  "shouldRetry": true/false,
  "decision": "continue" | "replan" | "retry" | "done",
  "recommendations": ["推奨1", "推奨2", ...],
  "failureReasons": ["失敗理由1", "失敗理由2", ...]
}`;

        const response = await this.llm.invoke([new SystemMessage(prompt)]);
        const content = response.content as string;

        // JSONをパース
        let parsed: any;
        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                parsed = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('JSON not found in response');
            }
        } catch (e) {
            // パースに失敗したらデフォルト値
            const hasErrors = errorTasks > 0;
            parsed = {
                summary: content.slice(0, 200),
                overallSuccess: !hasErrors && completedTasks === totalTasks,
                isGoalAchieved: !hasErrors && completedTasks === totalTasks,
                shouldReplan: hasErrors,
                shouldRetry: false,
                decision: hasErrors ? 'replan' : completedTasks === totalTasks ? 'done' : 'continue',
                recommendations: ['Unable to parse detailed recommendations'],
                failureReasons: hasErrors ? ['Tasks failed'] : [],
            };
        }

        return parsed;
    }

    getLogs() {
        return this.logManager.getLogs();
    }

    clearLogs() {
        this.logManager.clearLogs();
    }
}


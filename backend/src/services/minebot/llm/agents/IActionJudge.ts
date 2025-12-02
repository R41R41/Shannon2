/**
 * IActionJudge
 * アクション判定のインターフェース
 */

import { BaseMessage } from '@langchain/core/messages';

export type TaskAction = 'new_task' | 'feedback' | 'stop';

/**
 * アクション判定結果
 */
export interface ActionJudgementResult {
    action: TaskAction;
    reasoning: string;
    confidence?: number;
}

/**
 * アクション判定のインターフェース
 */
export interface IActionJudge {
    /**
     * プレイヤーメッセージからアクションを判定
     */
    judge(
        message: string,
        recentMessages: BaseMessage[],
        currentTaskContext?: any
    ): Promise<ActionJudgementResult>;
}


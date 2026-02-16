/**
 * ActionJudge
 * プレイヤーメッセージのアクション判定を担当
 * CentralAgentから分離して単一責任に
 */

import { BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { createLogger } from '../../../../utils/logger.js';
import { CONFIG } from '../../config/MinebotConfig.js';
import { LLMError } from '../../types/index.js';
import { errorHandler } from '../../utils/ErrorHandler.js';
import { ActionJudgementResult, IActionJudge, TaskAction } from './IActionJudge.js';

const log = createLogger('Minebot:ActionJudge');

/**
 * アクション判定のスキーマ（Structured Output用）
 */
const ActionJudgementSchema = z.object({
    action: z.enum(['new_task', 'feedback', 'stop']).describe(
        'プレイヤーの発言が新しいタスクの依頼か、既存タスクへのアドバイスか、タスク終了要望かを判定'
    ),
    reasoning: z.string().describe('判定の理由'),
    confidence: z.number().min(0).max(1).nullable().describe('判定の確信度 (0-1)'),
});

/**
 * ActionJudge
 * OpenAI Structured Outputを使用してアクション判定を行う
 */
export class ActionJudge implements IActionJudge {
    private openai: ChatOpenAI;

    constructor() {
        this.openai = new ChatOpenAI({
            modelName: CONFIG.CENTRAL_AGENT_MODEL,
            apiKey: CONFIG.OPENAI_API_KEY,
            temperature: CONFIG.TEMPERATURE_CENTRAL,
        });
        log.info(`🔍 ActionJudge initialized with ${CONFIG.CENTRAL_AGENT_MODEL}`);
    }

    /**
     * プレイヤーメッセージからアクションを判定
     */
    async judge(
        message: string,
        recentMessages: BaseMessage[],
        currentTaskContext?: any
    ): Promise<ActionJudgementResult> {
        const systemPrompt = this.buildSystemPrompt(currentTaskContext);

        log.info('🔍 ActionJudge: アクションを判定中...');

        const structuredLLM = this.openai.withStructuredOutput(ActionJudgementSchema, {
            name: 'action_judgement',
        });

        try {
            const result = await structuredLLM.invoke([
                new SystemMessage(systemPrompt),
                ...recentMessages.slice(-5), // 最新5件のみ使用してコスト削減
                new HumanMessage(message),
            ]);

            log.success(`✅ アクション判定完了: ${result.action} (理由: ${result.reasoning})`);

            return {
                action: result.action as TaskAction,
                reasoning: result.reasoning,
                confidence: result.confidence ?? undefined,
            };
        } catch (error) {
            const llmError = new LLMError('action-judgement', error as Error);
            errorHandler.handle(llmError);

            // エラー時はデフォルトでnew_taskを返す
            return {
                action: 'new_task',
                reasoning: 'エラーが発生したため、デフォルトで新しいタスクとして処理します',
                confidence: 0.0,
            };
        }
    }

    /**
     * システムプロンプトを構築
     */
    private buildSystemPrompt(currentTaskContext?: any): string {
        let prompt = `プレイヤーの発言が新しいタスクの依頼か、既存タスクへのアドバイスか、タスク終了要望かを判定してください。

判定基準:
- new_task: 「〜して」「〜を作って」などの新しいタスク依頼
- feedback: 「もっと〜して」「〜を変更して」などの既存タスクへのアドバイス
- stop: 「やめて」「中止して」などのタスク終了要望`;

        if (currentTaskContext) {
            prompt += `\n\n実行中のタスク: ${JSON.stringify(currentTaskContext)}`;
        }

        return prompt;
    }
}


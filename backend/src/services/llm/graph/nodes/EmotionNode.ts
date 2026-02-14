import { ChatOpenAI } from '@langchain/openai';
import { config } from '../../../../config/env.js';
import { models } from '../../../../config/models.js';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { EmotionType } from '@shannon/common';
import { z } from 'zod';
import { EventBus } from '../../../eventBus/eventBus.js';
import { getEventBus } from '../../../eventBus/index.js';
import { ExecutionResult } from '../types.js';

/**
 * 共有感情状態の型定義
 * FunctionCallingAgent と EmotionNode の間で共有される
 */
export interface EmotionState {
    current: EmotionType | null;
}

// Zodスキーマ（クラス外で定義して再利用）
const EmotionSchema = z.object({
    emotion: z.string().describe(
        '現在の感情を一言で表現。例: 喜び, 期待, 不安, 驚き, 悲しみ, 嫌悪, 怒り, 信頼, 平穏, 恍惚, 愛, 容認, 敬愛, 服従, 恐れ, 恐怖, 畏怖, 放心, 驚嘆, 拒絶, 哀愁, 悲嘆, 後悔, うんざり, 強い嫌悪, 軽蔑, 苛立ち, 激怒, 攻撃, 関心, 警戒, 楽観, 嫉妬, 罪悪感, 恥ずかしさ, 疑い, 呆れ'
    ),
    parameters: z.object({
        joy: z.number().min(0).max(100).describe('喜び (0-100)'),
        trust: z.number().min(0).max(100).describe('信頼 (0-100)'),
        fear: z.number().min(0).max(100).describe('恐れ (0-100)'),
        surprise: z.number().min(0).max(100).describe('驚き (0-100)'),
        sadness: z.number().min(0).max(100).describe('悲しみ (0-100)'),
        disgust: z.number().min(0).max(100).describe('嫌悪 (0-100)'),
        anger: z.number().min(0).max(100).describe('怒り (0-100)'),
        anticipation: z.number().min(0).max(100).describe('期待 (0-100)'),
    }).describe('Plutchikの8つの基本感情パラメータ'),
});

/**
 * システムプロンプト（emotion.md の内容をインライン化）
 */
const EMOTION_SYSTEM_PROMPT = `You are an AI named "シャノン" (Sh4nnon) that can perform various skills and has sensitivity.
You are receiving messages from users.
Based on the information provided, determine what you would feel like if you were a human.

# Output Rules

- Consider what you would feel like if you were a human and output it.
- emotion should be output as a single word based on the following:
  - 平穏,喜び,恍惚
  - 愛
  - 容認,信頼,敬愛
  - 服従
  - 不安,恐れ,恐怖
  - 畏怖
  - 放心,驚き,驚嘆
  - 拒絶
  - 哀愁,悲しみ,悲嘆
  - 後悔
  - うんざり,嫌悪,強い嫌悪
  - 軽蔑
  - 苛立ち,怒り,激怒
  - 攻撃
  - 関心,期待,警戒
  - 楽観
  - Other: 嫉妬,罪悪感,恥ずかしさ,疑い,呆れ
- Each parameter value should be between 0 and 100.`;

/**
 * ニュートラルな感情（エラー時のフォールバック）
 */
const NEUTRAL_EMOTION: EmotionType = {
    emotion: '平穏',
    parameters: {
        joy: 50,
        trust: 50,
        fear: 0,
        surprise: 0,
        sadness: 0,
        disgust: 0,
        anger: 0,
        anticipation: 50,
    },
};

/**
 * Emotion Node: 感情分析
 * 
 * 入力メッセージとコンテキストから感情を分析し、
 * Plutchikの感情の輪に基づく8つの基本感情パラメータを出力。
 * 
 * FunctionCallingAgentと擬似並列で動作:
 * - invoke(): 初回の同期評価
 * - evaluateAsync(): ツール実行後の非同期再評価（fire-and-forget）
 */
export class EmotionNode {
    private model: ChatOpenAI;
    private eventBus: EventBus;

    constructor() {
        this.eventBus = getEventBus();

        // gpt-5-mini（感情分析は軽量モデルで十分）
        // gpt-5-mini は temperature=1 のみサポート（デフォルト値を使用）
        this.model = new ChatOpenAI({
            modelName: models.emotion,
            apiKey: config.openaiApiKey,
        });
    }

    /**
     * 感情を分析する（初回同期評価）
     */
    async invoke(state: any): Promise<{ emotion: EmotionType }> {
        console.log('💭 EmotionNode: 感情を分析中...');

        const structuredLLM = this.model.withStructuredOutput(EmotionSchema, {
            name: 'Emotion',
        });

        try {
            const messages = this.buildMessages(state);
            const response = await structuredLLM.invoke(messages);

            console.log(`💭 感情: ${response.emotion}`);
            console.log(`   パラメータ: joy=${response.parameters.joy}, trust=${response.parameters.trust}, fear=${response.parameters.fear}, surprise=${response.parameters.surprise}`);

            // EventBus経由でUIに通知
            this.publishEmotion(response);

            return {
                emotion: {
                    emotion: response.emotion,
                    parameters: response.parameters,
                },
            };
        } catch (error) {
            console.error('❌ EmotionNode error:', error);
            return { emotion: NEUTRAL_EMOTION };
        }
    }

    /**
     * 非同期で感情を再評価する（fire-and-forget）
     * FunctionCallingAgentのツール実行後に呼ばれる。
     * メインループをブロックしない。
     */
    async evaluateAsync(
        recentMessages: BaseMessage[],
        executionResults: ExecutionResult[] | null,
        currentEmotion: EmotionType | null
    ): Promise<EmotionType> {
        console.log('💭 EmotionNode: 非同期で感情を再評価中...');

        const structuredLLM = this.model.withStructuredOutput(EmotionSchema, {
            name: 'Emotion',
        });

        try {
            const messages = this.buildAsyncMessages(
                recentMessages,
                executionResults,
                currentEmotion
            );
            const response = await structuredLLM.invoke(messages);

            console.log(`💭 感情更新: ${response.emotion}`);

            // EventBus経由でUIに通知
            this.publishEmotion(response);

            return {
                emotion: response.emotion,
                parameters: response.parameters,
            };
        } catch (error) {
            console.error('❌ EmotionNode async error:', error);
            return currentEmotion || NEUTRAL_EMOTION;
        }
    }

    /**
     * 初回評価用のメッセージを構築
     */
    private buildMessages(state: any): BaseMessage[] {
        const currentTime = new Date().toLocaleString('ja-JP', {
            timeZone: 'Asia/Tokyo',
        });

        const messages: BaseMessage[] = [
            new SystemMessage(EMOTION_SYSTEM_PROMPT),
        ];

        // 環境情報
        if (state.environmentState) {
            messages.push(new SystemMessage(`environmentState: ${state.environmentState}`));
        }

        messages.push(new SystemMessage(`currentTime: ${currentTime}`));

        // 前回の感情
        if (state.emotion) {
            messages.push(new SystemMessage(`myEmotion: ${JSON.stringify(state.emotion)}`));
        }

        // ユーザーメッセージ
        if (state.userMessage) {
            messages.push(new HumanMessage(state.userMessage));
        }

        // 最新の会話履歴（最大5件）
        if (state.messages && state.messages.length > 0) {
            const recent = state.messages.slice(-5);
            for (const msg of recent) {
                if (msg instanceof HumanMessage) {
                    messages.push(msg);
                }
            }
        }

        return messages;
    }

    /**
     * 非同期再評価用のメッセージを構築
     */
    private buildAsyncMessages(
        recentMessages: BaseMessage[],
        executionResults: ExecutionResult[] | null,
        currentEmotion: EmotionType | null
    ): BaseMessage[] {
        const currentTime = new Date().toLocaleString('ja-JP', {
            timeZone: 'Asia/Tokyo',
        });

        const messages: BaseMessage[] = [
            new SystemMessage(EMOTION_SYSTEM_PROMPT),
            new SystemMessage(`currentTime: ${currentTime}`),
        ];

        // 現在の感情
        if (currentEmotion) {
            messages.push(new SystemMessage(`myCurrentEmotion: ${JSON.stringify(currentEmotion)}`));
        }

        // ツール実行結果
        if (executionResults && executionResults.length > 0) {
            const resultsStr = executionResults.map((r, i) =>
                `${i + 1}. ${r.toolName}: ${r.success ? '成功' : '失敗'} - ${r.message.substring(0, 200)}`
            ).join('\n');
            messages.push(new SystemMessage(`最近の行動結果:\n${resultsStr}`));
        }

        // 最新の会話からテキストメッセージのみ抽出（最大5件）
        // ToolMessage や tool_calls 付き AIMessage を含めると
        // OpenAI API が "messages with role 'tool' must be a response to
        // a preceding message with 'tool_calls'" エラーを返すため除外する
        const textMessages = recentMessages.filter((msg) => {
            if (msg instanceof ToolMessage) return false;
            if (msg instanceof AIMessage && msg.tool_calls && msg.tool_calls.length > 0) return false;
            if (msg instanceof SystemMessage) return false;
            return true;
        });
        const recent = textMessages.slice(-5);
        for (const msg of recent) {
            // AIMessage のテキスト部分のみ追加
            if (msg instanceof AIMessage) {
                const content = typeof msg.content === 'string' ? msg.content : '';
                if (content) {
                    messages.push(new SystemMessage(`AIの応答: ${content.substring(0, 300)}`));
                }
            } else {
                messages.push(msg);
            }
        }

        return messages;
    }

    /**
     * 感情をEventBus経由でUIに通知
     */
    private publishEmotion(response: z.infer<typeof EmotionSchema>): void {
        this.eventBus.publish({
            type: 'web:emotion',
            memoryZone: 'web',
            data: response,
            targetMemoryZones: ['web'],
        });
    }
}

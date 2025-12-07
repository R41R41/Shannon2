import { ChatOpenAI } from '@langchain/openai';
import { EmotionType } from '@shannon/common';
import { z } from 'zod';
import { EventBus } from '../../../eventBus/eventBus.js';
import { getEventBus } from '../../../eventBus/index.js';
import { Prompt } from '../prompt.js';

/**
 * Emotion Node: 感情分析
 * 
 * 入力メッセージとコンテキストから感情を分析し、
 * Plutchikの感情の輪に基づく8つの基本感情パラメータを出力
 */
export class EmotionNode {
    private model: ChatOpenAI;
    private prompt: Prompt;
    private eventBus: EventBus;

    constructor(prompt: Prompt) {
        this.prompt = prompt;
        this.eventBus = getEventBus();

        // gpt-4o-mini（感情分析は軽量モデルで十分）
        this.model = new ChatOpenAI({
            modelName: 'gpt-4o-mini',
            apiKey: process.env.OPENAI_API_KEY!,
            temperature: 0.7,
        });
    }

    /**
     * 感情を分析する
     */
    async invoke(state: any): Promise<{ emotion: EmotionType }> {
        console.log('💭 EmotionNode: 感情を分析中...');

        // Zodスキーマによる構造化出力
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

        const structuredLLM = this.model.withStructuredOutput(EmotionSchema, {
            name: 'Emotion',
        });

        try {
            const messages = this.prompt.getMessages(state, 'emotion', false, false);
            const response = await structuredLLM.invoke(messages);

            console.log(`💭 感情: ${response.emotion}`);
            console.log(`   パラメータ: joy=${response.parameters.joy}, trust=${response.parameters.trust}, fear=${response.parameters.fear}, surprise=${response.parameters.surprise}`);

            // EventBus経由でUIに通知
            this.eventBus.publish({
                type: 'web:emotion',
                memoryZone: 'web',
                data: response,
                targetMemoryZones: ['web'],
            });

            return {
                emotion: {
                    emotion: response.emotion,
                    parameters: response.parameters,
                },
            };
        } catch (error) {
            console.error('❌ EmotionNode error:', error);

            // エラー時はニュートラルな感情を返す
            return {
                emotion: {
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
                },
            };
        }
    }
}


import { AIMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { CustomBot } from '../../../types.js';
import { CentralLogManager, LogManager } from '../logging/index.js';

/**
 * Understanding Node
 * ユーザーの意図と現在の状況を理解する
 */
export class UnderstandingNode {
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
        this.logManager = this.centralLogManager.getLogManager('understanding_node');
    }

    async invoke(state: any): Promise<any> {
        console.log('🧠 UnderstandingNode: 状況理解中...');

        try {
            // 現在の状況を詳細に収集
            const situationAnalysis = await this.analyzeSituation(state);

            this.logManager.addLog({
                phase: 'understanding',
                level: 'info',
                source: 'understanding_node',
                content: situationAnalysis.summary,
                metadata: {
                    details: situationAnalysis,
                },
            });

            console.log('✅ 状況理解完了');

            return {
                ...state,
                understanding: situationAnalysis,
                messages: [
                    ...state.messages,
                    new AIMessage(`Situation understood: ${situationAnalysis.summary}`),
                ],
            };
        } catch (error: any) {
            console.error('❌ UnderstandingNode エラー:', error);

            this.logManager.addLog({
                phase: 'understanding',
                level: 'error',
                source: 'understanding_node',
                content: `Failed to understand situation: ${error.message}`,
                metadata: {
                    error: error.message,
                },
            });

            return {
                ...state,
                error: `Understanding failed: ${error.message}`,
            };
        }
    }

    /**
     * 状況を分析
     */
    private async analyzeSituation(state: any): Promise<{
        summary: string;
        currentLocation: any;
        currentHealth: number;
        currentFood: number;
        inventoryItems: any[];
        nearbyEntities: string[];
        environmentContext: string;
        keyObservations: string[];
    }> {
        // 現在の状態を収集
        const currentLocation = this.bot.entity?.position || null;
        const currentHealth = this.bot.health || 0;
        const currentFood = this.bot.food || 0;
        const inventoryItems = this.bot.inventory.items().map(item => ({
            name: item.name,
            count: item.count,
        }));

        // 周辺のエンティティを取得
        const nearbyEntities = Object.values(this.bot.entities)
            .filter((entity: any) => {
                if (!entity.position || !currentLocation) return false;
                const distance = entity.position.distanceTo(currentLocation);
                return distance < 20; // 20ブロック以内
            })
            .map((entity: any) => entity.name || entity.username || 'unknown')
            .slice(0, 10); // 最大10個

        // 環境コンテキスト
        const dimension = this.bot.game?.dimension || 'unknown';
        const weather = this.bot.isRaining ? 'raining' : 'clear';
        const timeOfDay = this.bot.time?.timeOfDay || 0;
        const time = timeOfDay < 6000 ? 'morning' : timeOfDay < 12000 ? 'noon' : timeOfDay < 18000 ? 'evening' : 'night';

        const environmentContext = `Dimension: ${dimension}, Weather: ${weather}, Time: ${time}`;

        // LLMに状況を要約させる
        const prompt = `あなたはMinecraftボットです。現在の状況を分析してください。

ゴール: ${state.goal}

現在の状態:
- 位置: ${JSON.stringify(currentLocation)}
- HP: ${currentHealth}/20
- 満腹度: ${currentFood}/20
- インベントリ: ${JSON.stringify(inventoryItems.slice(0, 5))}
- 周辺のエンティティ: ${nearbyEntities.join(', ')}
- 環境: ${environmentContext}

以下を簡潔に分析してください:
1. 現在の状況の要約（1-2文）
2. ゴール達成に重要な観察事項（3-5個）

JSON形式で返してください:
{
  "summary": "状況の要約",
  "keyObservations": ["観察1", "観察2", ...]
}`;

        const response = await this.llm.invoke([new SystemMessage(prompt)]);
        const content = response.content as string;

        // JSONをパース（LLMが正しくJSON返すことを期待）
        let parsed: any;
        try {
            // ```json ``` で囲まれている場合があるので、それを除去
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                parsed = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('JSON not found in response');
            }
        } catch (e) {
            // パースに失敗したらデフォルト値
            parsed = {
                summary: content.slice(0, 200),
                keyObservations: ['Unable to parse detailed observations'],
            };
        }

        return {
            summary: parsed.summary,
            currentLocation,
            currentHealth,
            currentFood,
            inventoryItems,
            nearbyEntities,
            environmentContext,
            keyObservations: parsed.keyObservations || [],
        };
    }

    getLogs() {
        return this.logManager.getLogs();
    }

    clearLogs() {
        this.logManager.clearLogs();
    }
}


import pathfinder from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';
import HoldItem from './holdItem.js';
const { goals } = pathfinder;

class DigBlock extends InstantSkill {
    private holdItem: HoldItem;
    constructor(bot: CustomBot) {
        super(bot);
        this.holdItem = new HoldItem(bot);
        this.skillName = 'dig-block';
        this.description = '指定された座標のブロックを掘ります。';
        this.status = false;
        this.params = [
            {
                name: 'coordinate',
                description: '掘るブロックの座標',
                type: 'Vec3',
                default: null,
            },
        ];
    }

    async runImpl(coordinate: Vec3) {
        console.log('digBlock', coordinate);
        try {
            if (coordinate) {
                const goal = new goals.GoalNear(
                    coordinate.x,
                    coordinate.y,
                    coordinate.z,
                    1
                );
                const movePromise = this.bot.pathfinder.goto(goal);
                await movePromise;
                const block = this.bot.blockAt(coordinate);
                if (!block) {
                    return { success: false, result: `座標${coordinate.x} ${coordinate.y} ${coordinate.z}にブロックが見つかりません。` };
                }

                const toolIds = block.harvestTools ? Object.keys(block.harvestTools).map(Number) : [];
                const hasTool = this.bot.inventory.items().some(item => toolIds.includes(item.type));
                if (!hasTool && block.harvestTools !== undefined) {
                    return { success: false, result: `掘るためのツールがインベントリにありません。` };
                }
                const bestTool = this.bot.pathfinder.bestHarvestTool(block);
                if (bestTool) {
                    await this.holdItem.run(bestTool.name);
                }

                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('掘るブロックの取得に失敗しました')), 30000);
                });
                const digPromise = this.bot.dig(block);
                await Promise.race([digPromise, timeoutPromise]);
                return { success: true, result: `座標${coordinate.x} ${coordinate.y} ${coordinate.z}のブロックを掘りました。` };
            } else {
                return { success: false, result: `座標が指定されていません。` };
            }
        } catch (error) {
            return { success: false, result: `掘るブロックの取得に失敗しました: ${error}` };
        }
    }
}

export default DigBlock;
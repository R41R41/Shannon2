import { InstantSkill, CustomBot } from "../types.js";
import { goals } from 'mineflayer-pathfinder';
import minecraftData from 'minecraft-data';
import { Item } from 'prismarine-item';

class UseItemToBlock extends InstantSkill {
    private mcData: any;
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'use-item-to-block';
        this.description = '指定したアイテムを指定したブロックの位置に対して使用します。';
        this.priority = 100;
        this.canUseByCommand = true;
        this.mcData = minecraftData(this.bot.version);
        this.params = [
            {
                name: 'itemName',
                description: '使用するアイテムの名前',
                type: 'string',
            },
            {
                name: 'targetBlockName',
                description: '使用するブロックの名前',
                type: 'string',
            },
            {
                name: 'blockCount',
                description: '使用されるブロックの数',
                type: 'number',
            },
            {
                name: 'isCheckBlockAbove',
                description: '上にブロックがないブロックを探すかどうか',
                type: 'boolean',
            },
        ];
    }

    async run(itemName: string, targetBlockName: string, blockCount: number, isCheckBlockAbove: boolean) {
        try {
            const Item = this.mcData.itemsByName[itemName];
            if (!Item) {
                return { success: false, result: `アイテム${itemName}はありません` };
            }
            const items = this.bot.inventory.items().filter((i) => i.name === Item.name);
            if (items.length === 0) {
                return {
                    success: false,
                    result: `アイテム${itemName}がインベントリに見つかりません`,
                };
            }
            const Block = this.mcData.blocksByName[targetBlockName];
            if (!Block) {
                return { success: false, result: `ブロック${targetBlockName}はありません` };
            }
            let count = 0;
            while (count < blockCount) {
                const Blocks = this.bot.findBlocks({
                    matching: Block.id,
                    maxDistance: 64,
                    count: 64,
                });
                if (Blocks.length === 0) {
                    return {
                        success: false,
                        result: `周囲64ブロック以内に${targetBlockName}は見つかりませんでした`,
                    };
                }
                let validBlocks = Blocks;
                if (isCheckBlockAbove) {
                    // 上にブロックがないブロックを探す
                    validBlocks = Blocks.filter((pos) => {
                        const blockAbove = this.bot.blockAt(pos.offset(0, 1, 0));
                        console.log(blockAbove);
                        return !blockAbove || blockAbove.type === 0; // type 0 は air
                    });
                    if (validBlocks.length === 0) {
                        return {
                            success: false,
                            result: `上が開いている${targetBlockName}が見つかりませんでした`,
                        };
                    }
                }

                // 最初の有効なブロックを使用
                const block = this.bot.blockAt(validBlocks[0]);
                if (!block) {
                    return {
                        success: false,
                        result: `ブロックが見つかりませんでした`,
                    };
                }
                await this.bot.pathfinder.goto(
                    new goals.GoalNear(block.position.x, block.position.y, block.position.z, 3)
                );
                const item = this.bot.inventory.items().find((i) => i.name === Item.name);
                await this.bot.equip(item as Item, 'hand');
                await this.bot.activateBlock(block);
                await new Promise((resolve) => setTimeout(resolve, 1000));
                count++;
            }
            return {
                success: true,
                result: `アイテム${itemName}を${targetBlockName}に使用しました`,
            };
        } catch (error: any) {
            return { success: false, result: `${error.message} in ${error.stack}` };
        }
    }
}

module.exports = UseItemToBlock;

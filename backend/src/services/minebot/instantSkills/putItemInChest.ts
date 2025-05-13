import { CustomBot, InstantSkill } from '../types.js';
import { Vec3 } from 'vec3';

class PutItemInChest extends InstantSkill {
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'put-item-in-chest';
        this.description = 'チェストにアイテムを入れます';
        this.bot = bot;
        this.params = [
            {
                name: 'chestPosition',
                type: 'Vec3',
                description: 'チェストの座標',
                required: true,
            },
            {
                name: 'itemName',
                type: 'string',
                description: '入れるアイテムの名前',
                required: true,
            },
            {
                name: 'amount',
                type: 'number',
                description: '入れるアイテムの数',
                required: true,
            },
        ];
        this.canUseByCommand = false;
    }

    async run(chestPosition: Vec3, itemName: string, amount: number) {
        try {
            // ブロック確認
            const block = this.bot.blockAt(chestPosition);
            if (!block || !block.name.includes('chest')) {
                return {
                    success: false,
                    result: `座標 (${chestPosition.x}, ${chestPosition.y}, ${chestPosition.z}) にチェストがありません。`
                };
            }

            // インベントリからアイテムを探す
            const items = this.bot.inventory.items();
            const targetItems = items.filter(item => 
                item.name.includes(itemName) || 
                (item.displayName && item.displayName.toLowerCase().includes(itemName.toLowerCase()))
            );

            if (targetItems.length === 0) {
                return {
                    success: false,
                    result: `インベントリ内に "${itemName}" が見つかりませんでした。`
                };
            }

            // チェストを開く
            const chest = await this.bot.openChest(block);
            
            // アイテム格納の実行
            let remainingAmount = amount;
            let totalDeposited = 0;

            for (const item of targetItems) {
                if (remainingAmount <= 0) break;
                
                const depositAmount = Math.min(remainingAmount, item.count);
                await chest.deposit(item.type, item.metadata, depositAmount);
                
                remainingAmount -= depositAmount;
                totalDeposited += depositAmount;
            }

            // チェストを閉じる
            await chest.close();

            if (totalDeposited === 0) {
                return {
                    success: false,
                    result: `"${itemName}" をチェストに格納できませんでした。`
                };
            } else if (totalDeposited < amount) {
                return {
                    success: true,
                    result: `"${itemName}" を ${totalDeposited}個チェストに格納しました（要求: ${amount}個）。`
                };
            } else {
                return {
                    success: true,
                    result: `"${itemName}" を ${amount}個チェストに格納しました。`
                };
            }
        } catch (error: any) {
            return {
                success: false,
                result: `チェストにアイテムを格納中にエラーが発生しました: ${error.message}`
            };
        }
    }
}

export default PutItemInChest;
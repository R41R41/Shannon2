import { CustomBot, InstantSkill } from '../types.js';
import { Vec3 } from 'vec3';

class GetItemFromChest extends InstantSkill {
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'get-item-from-chest';
        this.description = 'チェストからアイテムを取得します';
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
                description: '取得するアイテムの名前',
                required: true,
            },
            {
                name: 'amount',
                type: 'number',
                description: '取得するアイテムの数',
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

            // チェストを開く
            const chest = await this.bot.openChest(block);
            const chestSlotCount = chest.inventoryStart; // inventoryStartがチェストスロット数
            const items = chest.slots
                .slice(0, chestSlotCount)
                .filter(item => item !== null);
            const targetItems = items.filter(item => 
                item.name.includes(itemName) || 
                (item.displayName && item.displayName.toLowerCase().includes(itemName.toLowerCase()))
            );

            if (targetItems.length === 0) {
                await chest.close();
                return {
                    success: false,
                    result: `チェスト内に "${itemName}" が見つかりませんでした。`
                };
            }

            // アイテム取得の実行
            let remainingAmount = amount;
            let totalWithdrawn = 0;

            for (const item of targetItems) {
                if (remainingAmount <= 0) break;
                
                const withdrawAmount = Math.min(remainingAmount, item.count);
                await chest.withdraw(item.type, item.metadata, withdrawAmount);
                
                remainingAmount -= withdrawAmount;
                totalWithdrawn += withdrawAmount;
            }

            // チェストを閉じる
            await chest.close();

            if (totalWithdrawn === 0) {
                return {
                    success: false,
                    result: `"${itemName}" を取得できませんでした。`
                };
            } else if (totalWithdrawn < amount) {
                return {
                    success: true,
                    result: `"${itemName}" を ${totalWithdrawn}個取得しました（要求: ${amount}個）。`
                };
            } else {
                return {
                    success: true,
                    result: `"${itemName}" を ${amount}個取得しました。`
                };
            }
        } catch (error: any) {
            return {
                success: false,
                result: `チェストからアイテムを取得中にエラーが発生しました: ${error.message}`
            };
        }
    }
}

export default GetItemFromChest;
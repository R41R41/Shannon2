import { CustomBot, InstantSkill } from '../types.js';
import fs from 'fs';

class GetInventoryItems extends InstantSkill {
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'get-inventory-items';
        this.description = 'インベントリーのアイテムと装備を取得します';
        this.bot = bot;
        this.params = [];
        this.canUseByCommand = false;
    }

    async run() {
        try {
            const items = this.bot.inventory.items();
            const path = require('path');
            const filePath = path.join(
                process.cwd(),
                '..',
                '..',
                'saves',
                'minecraft',
                'inventory.txt'
            );

            // 装備アイテムの取得
            const helmet = this.bot.inventory.slots[5];
            const chestplate = this.bot.inventory.slots[6];
            const leggings = this.bot.inventory.slots[7];
            const boots = this.bot.inventory.slots[8];
            const quickBarSlot = this.bot.quickBarSlot; // 0-8の値
            const mainHand = this.bot.inventory.slots[36 + quickBarSlot];
            const offHand = this.bot.inventory.slots[45];
            
            // 装備の情報を作成
            const equipmentInfo = [
                '===== 装備アイテム =====',
                `ヘルメット: ${helmet ? helmet.name : 'なし'}`,
                `チェストプレート: ${chestplate ? chestplate.name : 'なし'}`,
                `レギンス: ${leggings ? leggings.name : 'なし'}`,
                `ブーツ: ${boots ? boots.name : 'なし'}`,
                `メインハンド: ${mainHand ? `${mainHand.name} (数量: ${mainHand.count})` : 'なし'}`,
                `オフハンド: ${offHand ? `${offHand.name} (数量: ${offHand.count})` : 'なし'}`,
                '===== インベントリアイテム ====='
            ].join('\n');

            // インベントリアイテムの情報
            const itemDescriptions = items
                .map((item) => `name: ${item.name}, count: ${item.count}`)
                .join('\n');

            // ファイルに書き込み
            fs.writeFileSync(filePath, `${equipmentInfo}\n${itemDescriptions}`);

            return {
                success: true,
                result: `インベントリーと装備のデータを以下に格納しました: ${filePath}`,
            };
        } catch (error: any) {
            return { success: false, result: `${error.message} in ${error.stack}` };
        }
    }
}

export default GetInventoryItems;

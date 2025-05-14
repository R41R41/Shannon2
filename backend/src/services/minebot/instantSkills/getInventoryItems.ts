import { CustomBot, InstantSkill } from '../types.js';
import fs from 'fs';
import path from 'path';

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
      const filePath = path.join(
        process.cwd(),
        'saves',
        'minecraft',
        'inventory_data.json'
      );

      // 装備アイテムの取得
      const helmet = this.bot.inventory.slots[5];
      const chestplate = this.bot.inventory.slots[6];
      const leggings = this.bot.inventory.slots[7];
      const boots = this.bot.inventory.slots[8];
      const quickBarSlot = this.bot.quickBarSlot; // 0-8の値
      const mainHand = this.bot.inventory.slots[36 + quickBarSlot];
      const offHand = this.bot.inventory.slots[45];

      // JSON形式で装備情報を作成
      const equipmentInfo = {
        equipment: {
          helmet: helmet ? { name: helmet.name, count: helmet.count } : null,
          chestplate: chestplate
            ? { name: chestplate.name, count: chestplate.count }
            : null,
          leggings: leggings
            ? { name: leggings.name, count: leggings.count }
            : null,
          boots: boots ? { name: boots.name, count: boots.count } : null,
          mainHand: mainHand
            ? { name: mainHand.name, count: mainHand.count }
            : null,
          offHand: offHand
            ? { name: offHand.name, count: offHand.count }
            : null,
        },
        inventory: items.map((item) => ({
          name: item.name,
          count: item.count,
        })),
      };

      // JSON形式でファイルに保存
      fs.writeFileSync(filePath, JSON.stringify(equipmentInfo, null, 2));

      return {
        success: true,
        result: `インベントリーデータ：${JSON.stringify(equipmentInfo)}`,
      };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default GetInventoryItems;

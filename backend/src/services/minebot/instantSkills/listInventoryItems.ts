import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: インベントリの全アイテムをリスト表示
 */
class ListInventoryItems extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'list-inventory-items';
    this.description = 'インベントリ内の全アイテムをリスト表示します。';
    this.params = [];
  }

  async runImpl() {
    try {
      const items = this.bot.inventory.items();

      if (items.length === 0) {
        return {
          success: true,
          result: 'インベントリは空です',
        };
      }

      // アイテムを集計
      const itemMap = new Map<string, number>();
      items.forEach((item) => {
        const current = itemMap.get(item.name) || 0;
        itemMap.set(item.name, current + item.count);
      });

      // 結果を整形
      const itemList = Array.from(itemMap.entries())
        .map(([name, count]) => `${name} x${count}`)
        .join(', ');

      const totalSlots = items.length;
      const emptySlots = 36 - totalSlots; // 通常36スロット

      return {
        success: true,
        result: `インベントリ(${totalSlots}/36スロット使用): ${itemList}`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `取得エラー: ${error.message}`,
      };
    }
  }
}

export default ListInventoryItems;

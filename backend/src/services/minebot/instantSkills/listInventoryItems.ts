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

      // デバッグ: 全スロットを確認
      console.log('🔍 インベントリ詳細:');
      const allSlots = this.bot.inventory.slots;
      allSlots.forEach((slot, index) => {
        if (slot) {
          console.log(`  Slot ${index}: ${slot.name} x${slot.count}`);
        }
      });

      // ホットバー（スロット36-44）も確認
      console.log('🔍 ホットバー:');
      for (let i = 36; i <= 44; i++) {
        const slot = this.bot.inventory.slots[i];
        if (slot) {
          console.log(`  Hotbar ${i - 36}: ${slot.name} x${slot.count}`);
        }
      }

      // 手持ちアイテム
      const heldItem = this.bot.heldItem;
      if (heldItem) {
        console.log(`🔍 手持ち: ${heldItem.name} x${heldItem.count}`);
      }

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

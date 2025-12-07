import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 現在の装備を確認
 */
class GetEquipment extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'get-equipment';
    this.description = '現在装備しているアイテムと防具を確認します。';
    this.params = [];
  }

  async runImpl() {
    try {
      const equipment: string[] = [];

      // 手持ちアイテム
      const heldItem = this.bot.heldItem;
      if (heldItem) {
        equipment.push(`手: ${heldItem.name} x${heldItem.count}`);
      } else {
        equipment.push('手: なし');
      }

      // 防具
      const slots = ['head', 'torso', 'legs', 'feet', 'off-hand'] as const;
      const slotNames = {
        head: '頭',
        torso: '胴',
        legs: '脚',
        feet: '足',
        'off-hand': 'オフハンド',
      };

      for (const slot of slots) {
        const item =
          this.bot.inventory.slots[this.bot.getEquipmentDestSlot(slot)];
        if (item) {
          const durability = item.durabilityUsed
            ? ` (耐久${item.maxDurability - item.durabilityUsed}/${
                item.maxDurability
              })`
            : '';
          equipment.push(`${slotNames[slot]}: ${item.name}${durability}`);
        } else {
          equipment.push(`${slotNames[slot]}: なし`);
        }
      }

      return {
        success: true,
        result: `現在の装備: ${equipment.join(', ')}`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `取得エラー: ${error.message}`,
      };
    }
  }
}

export default GetEquipment;

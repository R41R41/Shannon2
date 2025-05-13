import { InstantSkill, CustomBot } from '../types.js';
import { EquipmentDestination } from 'mineflayer';

class EquipArmor extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'equip-armor';
    this.description = '指定された防具を装備します。';
    this.params = [
      {
        name: 'armorType',
        type: 'string',
        description:
          '装備する防具の種類。またはnullで全ての防具を脱ぎます。例: helmet, chestplate, leggings, boots, null',
        default: 'null',
      },
    ];
  }

  async run(armorType: string) {
    console.log(`equipArmor ${armorType}`);
    try {
      if (armorType == null) {
        const armorSlots = ['head', 'torso', 'legs', 'feet'];
        let unequipped = false;
        for (const slot of armorSlots) {
          if (this.bot.inventory.slots[this.bot.getEquipmentDestSlot(slot)]) {
            await this.bot.unequip(slot as EquipmentDestination);
            unequipped = true;
          }
        }
        if (unequipped) {
          return { success: true, result: '全ての防具を脱ぎました。' };
        } else {
          return { success: true, result: '既に全ての防具を脱いでいます。' };
        }
      } else {
        const armor = this.bot.inventory
          .items()
          .find((item) => item.name.includes(armorType));
        if (armor) {
          const equipSlot =
            {
              helmet: 'head',
              chestplate: 'torso',
              leggings: 'legs',
              boots: 'feet',
            }[armorType] || 'head';
          await this.bot.equip(armor, equipSlot as EquipmentDestination);
          return { success: true, result: `${armorType} を装備しました。` };
        } else {
          return { success: false, result: `${armorType} が見つかりません。` };
        }
      }
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default EquipArmor;

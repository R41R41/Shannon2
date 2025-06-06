import { InstantSkill, CustomBot } from '../types.js';
import { EquipmentDestination } from 'mineflayer';

class EquipArmor extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'equip-armor';
    this.description = '指定された防具を装備します。nullを指定するとその部位または全ての防具を脱ぎます。';
    this.params = [
      {
        name: 'armorName',
        type: 'string',
        description:
          '装備する防具の名前。その部位に何も着ない場合はnullを指定してください。例: diamond_helmet, iron_chestplate, golden_boots, curved_pumpkin, dragon_head, null',
        default: 'null',
      },
      {
        name: 'armorSlot',
        type: 'string',
        description:
          '装備する体の部位。何も着ない場合はnullを指定してください。例: head, torso, legs, feet, null',
        default: 'null',
      },
    ];
  }

  async runImpl(armorName: string, armorSlot: string) {
    console.log(`equipArmor ${armorName} ${armorSlot}`);
    try {
      const armorSlots = ['head', 'torso', 'legs', 'feet'];
      if (!armorSlots.includes(armorSlot) && armorSlot != null) {
        return { success: false, result: '無効な部位です。' };
      }
      if (armorSlot == null) {
        for (const slot of armorSlots) {
          if (this.bot.inventory.slots[this.bot.getEquipmentDestSlot(slot)]) {
            await this.bot.unequip(slot as EquipmentDestination);
          }
        }
        return { success: true, result: '全ての防具を脱ぎました。' };
      }
      if (armorName == null) {
        if (this.bot.inventory.slots[this.bot.getEquipmentDestSlot(armorSlot)]) {
          await this.bot.unequip(armorSlot as EquipmentDestination);
          return { success: true, result: `${armorSlot} を脱ぎました。` };
        } else {
          return { success: true, result: `${armorSlot} は既に脱いでいます。` };
        }
      } else {
        const armor = this.bot.inventory
          .items()
          .find((item) => item.name === armorName);
        if (armor) {
          await this.bot.equip(armor, armorSlot as EquipmentDestination);
          return { success: true, result: `${armorName} を装備しました。` };
        } else {
          return { success: false, result: `${armorName} が見つかりません。` };
        }
      }
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default EquipArmor;

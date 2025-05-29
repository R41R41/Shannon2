import { CustomBot, InstantSkill } from '../types.js';

class HoldItem extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'hold-item';
    this.description = 'インベントリの中から指定したアイテムを手に持ちます。';
    this.params = [
      {
        name: 'itemName',
        type: 'string',
        description:
          '手に持つアイテムの名前。nullを指定すると何も持たない状態になります。例: iron_sword, diamond_axe, など',
        default: 'null',
      },
      {
        name: 'isOfhand',
        type: 'boolean',
        description: 'Offhandに持つかどうか',
        default: 'false',
      },
    ];
  }

  /**
   * @param {string} itemName
   * @param {string} isOfhand
   */
  async run(itemName: string, isOfhand: boolean) {
    console.log('holdItem', itemName, isOfhand);
    try {
      let hand = isOfhand ? 'off-hand' : 'hand';

      if (!itemName || itemName === 'null' || itemName === '') {
        await this.bot.unequip(hand as any);
        return {
          success: true,
          result: `${hand}から全てのアイテムを外しました。`,
        };
      }

      const item = this.bot.inventory.items().find((i) => i.name === itemName);
      if (item) {
        await this.bot.equip(item, hand as any);
        return { success: true, result: `${itemName}を${hand}に持ちました。` };
      } else {
        return {
          success: false,
          result: `${itemName}がインベントリに見つかりません。`,
        };
      }
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default HoldItem;

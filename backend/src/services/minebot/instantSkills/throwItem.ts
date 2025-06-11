import { CustomBot, InstantSkill } from '../types.js';

class ThrowItem extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'throw-item';
    this.description = '特定のアイテムをまとめて目の前に投げます。';
    this.priority = 50;
    this.params = [
      {
        name: 'itemName',
        type: 'string',
        description: '投げるアイテムの名前。例: iron_ingot, diamond, など',
        default: null,
      },
    ];
  }

  async runImpl(itemName: string) {
    try {
      console.log('throwItem', itemName);
      const item = this.bot.inventory
        .items()
        .find((item) => item.name === itemName);
      if (item) {
        const autoPickUpItem =
          this.bot.constantSkills.getSkill('autoPickUpItem');
        if (autoPickUpItem) {
          autoPickUpItem.status = false;
        }
        await this.bot.tossStack(item);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (autoPickUpItem) {
          autoPickUpItem.status = true;
        }
        return { success: true, result: 'アイテムを投げました' };
      } else {
        this.bot.chat('インベントリにそのアイテムはありません');
        return {
          success: false,
          result: 'インベントリにそのアイテムはありません',
        };
      }
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default ThrowItem;

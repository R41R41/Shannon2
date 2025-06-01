import { CustomBot, InstantSkill } from '../types.js';
import HoldItem from './holdItem.js';

class EatFood extends InstantSkill {
  private holdItem: HoldItem;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'eat-food';
    this.description = '指定されたアイテムを食べます。';
    this.status = false;
    this.params = [
      {
        name: 'itemName',
        description:
          '食べるアイテムの名前を指定します。例: apple, bread, beef, cooked_beef, など',
        type: 'string',
      },
    ];
    this.holdItem = new HoldItem(bot);
  }

  /**
   * @param {string} itemName
   */
  async runImpl(itemName: string) {
    console.log('eatFood', itemName);
    try {
      if (this.bot.food === 20) {
        return { success: false, result: '満腹なので食べることができません' };
      }
      await this.holdItem.run(itemName, false);
      this.bot.deactivateItem();
      this.bot.activateItem();
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return { success: true, result: `${itemName}を食べました` };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default EatFood;

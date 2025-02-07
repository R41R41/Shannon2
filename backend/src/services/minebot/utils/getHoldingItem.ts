import { CustomBot, Hand, ResponseType } from '../types.js';

export class GetHoldingItem {
  bot: CustomBot;
  constructor(bot: CustomBot) {
    this.bot = bot;
  }

  async run(hand: Hand): Promise<ResponseType> {
    try {
      const holdingItem =
        this.bot.inventory.slots[this.bot.getEquipmentDestSlot(hand)];
      if (!holdingItem) {
        return { success: true, result: 'no item' };
      }
      return { success: true, result: holdingItem.name };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

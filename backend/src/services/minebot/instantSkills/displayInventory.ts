import { CustomBot, InstantSkill } from '../types.js';

class DisplayInventory extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'display-inventory';
    this.description = 'インベントリの中身を表示します。';
    this.priority = 10;
    this.params = [];
  }

  async run() {
    try {
      const inventoryItems = await this.bot.inventory.items();
      inventoryItems.sort((a, b) => a.name.localeCompare(b.name));

      // メッセージを順番に送信
      for (const item of inventoryItems) {
        const message = JSON.stringify({
          text: `${item.name} ${item.count}`,
          color: 'gray',
          underlined: true,
          hoverEvent: {
            action: 'show_text',
            contents: `throw ${item.name}`,
          },
          clickEvent: {
            action: 'suggest_command',
            value: `./throw-item ${item.name}`,
          },
        });

        // メッセージを送信し、100ミリ秒待機
        await this.bot.chat(`/tellraw @a ${message}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      return { success: true, result: 'インベントリを表示しました' };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default DisplayInventory;

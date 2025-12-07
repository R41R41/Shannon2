import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: インベントリ内の特定アイテムの数を確認
 */
class CheckInventoryItem extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'check-inventory-item';
    this.description = 'インベントリ内の特定アイテムの数を確認します。';
    this.params = [
      {
        name: 'itemName',
        type: 'string',
        description: '確認するアイテム名',
        required: true,
      },
    ];
  }

  async runImpl(itemName: string) {
    try {
      const items = this.bot.inventory
        .items()
        .filter((item) => item.name === itemName);

      if (items.length === 0) {
        return {
          success: true,
          result: `${itemName}はインベントリにありません`,
        };
      }

      const totalCount = items.reduce((sum, item) => sum + item.count, 0);

      return {
        success: true,
        result: `${itemName}を${totalCount}個所持しています`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `確認エラー: ${error.message}`,
      };
    }
  }
}

export default CheckInventoryItem;

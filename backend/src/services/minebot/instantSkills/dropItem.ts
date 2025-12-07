import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: インベントリ内のアイテムをドロップ
 */
class DropItem extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'drop-item';
    this.description = 'インベントリから指定アイテムを指定数ドロップします。';
    this.params = [
      {
        name: 'itemName',
        type: 'string',
        description: 'ドロップするアイテム名',
        required: true,
      },
      {
        name: 'count',
        type: 'number',
        description: 'ドロップする数量（デフォルト: 1）',
        default: 1,
      },
    ];
  }

  async runImpl(itemName: string, count: number = 1) {
    try {
      const item = this.bot.inventory
        .items()
        .find((item) => item.name === itemName);

      if (!item) {
        return {
          success: false,
          result: `インベントリに${itemName}がありません`,
        };
      }

      const dropCount = Math.min(count, item.count);
      await this.bot.toss(item.type, null, dropCount);

      return {
        success: true,
        result: `${itemName}を${dropCount}個ドロップしました`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `ドロップエラー: ${error.message}`,
      };
    }
  }
}

export default DropItem;

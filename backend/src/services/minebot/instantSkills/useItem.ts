import minecraftData from 'minecraft-data';
import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: アイテムを使用（右クリック）
 */
class UseItem extends InstantSkill {
  private mcData: any;

  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'use-item';
    this.description = '指定したアイテムを装備して使用します（右クリック）。食べ物を食べる場合にも使用します。';
    this.mcData = minecraftData(this.bot.version);
    this.params = [
      {
        name: 'itemName',
        type: 'string',
        description: 'アイテム名（例: bread, apple, potion）。空の場合は手に持っているアイテムを使用',
        default: null,
      },
    ];
  }

  async runImpl(itemName: string | null = null) {
    try {
      // アイテム名が指定されている場合、装備する
      if (itemName) {
        const inventoryItem = this.bot.inventory.items().find(
          (item) => item.name === itemName
        );

        if (!inventoryItem) {
          return {
            success: false,
            result: `インベントリに${itemName}がありません`,
          };
        }

        await this.bot.equip(inventoryItem, 'hand');
      }

      const heldItem = this.bot.heldItem;

      if (!heldItem) {
        return {
          success: false,
          result: '手に何も持っていません',
        };
      }

      // アイテムが使用可能かチェック
      const item = this.mcData.itemsByName[heldItem.name];
      if (!item) {
        return {
          success: false,
          result: `${heldItem.name}は使用できません`,
        };
      }

      await this.bot.activateItem();

      return {
        success: true,
        result: `${heldItem.name}を使用しました`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `アイテム使用エラー: ${error.message}`,
      };
    }
  }
}

export default UseItem;

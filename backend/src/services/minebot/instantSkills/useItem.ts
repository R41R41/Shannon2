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
    this.description = '手に持っているアイテムを使用します（右クリック）。';
    this.mcData = minecraftData(this.bot.version);
    this.params = [];
  }

  async runImpl() {
    try {
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

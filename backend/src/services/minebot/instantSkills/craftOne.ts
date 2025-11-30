import minecraftData from 'minecraft-data';
import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: アイテムを1個クラフト
 */
class CraftOne extends InstantSkill {
  private mcData: any;

  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'craft-one';
    this.description = '指定アイテムを1個クラフトします。';
    this.mcData = minecraftData(this.bot.version);
    this.params = [
      {
        name: 'itemName',
        type: 'string',
        description: 'クラフトするアイテム名',
        required: true,
      },
    ];
  }

  async runImpl(itemName: string) {
    try {
      const item = this.mcData.itemsByName[itemName];
      if (!item) {
        return {
          success: false,
          result: `アイテム${itemName}が見つかりません`,
        };
      }

      // クラフトテーブルを探す
      const craftingTable = this.bot.findBlock({
        matching: this.mcData.blocksByName.crafting_table?.id,
        maxDistance: 4,
      });

      // レシピを取得
      const recipes = this.bot.recipesFor(item.id, null, 1, craftingTable);

      if (recipes.length === 0) {
        return {
          success: false,
          result: `${itemName}のレシピがありません。必要な材料が不足しているか、クラフトできないアイテムです`,
        };
      }

      const recipe = recipes[0];

      // クラフトテーブルが必要だが見つからない場合
      if (recipe.requiresTable && !craftingTable) {
        return {
          success: false,
          result: `${itemName}のクラフトにはクラフトテーブルが必要ですが、近くに見つかりません`,
        };
      }

      // クラフト実行
      await this.bot.craft(recipe, 1, craftingTable ?? undefined);

      return {
        success: true,
        result: `${itemName}を1個クラフトしました`,
      };
    } catch (error: any) {
      // エラーメッセージを詳細化
      let errorDetail = error.message;
      if (error.message.includes('missing')) {
        errorDetail = '必要な材料が不足しています';
      } else if (error.message.includes('table')) {
        errorDetail = 'クラフトテーブルが必要です';
      }

      return {
        success: false,
        result: `クラフトエラー: ${errorDetail}`,
      };
    }
  }
}

export default CraftOne;

import minecraftData from 'minecraft-data';
import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: クラフト可能なレシピを確認
 */
class CheckRecipe extends InstantSkill {
  private mcData: any;

  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'check-recipe';
    this.description = '指定アイテムのクラフトレシピを確認します。';
    this.mcData = minecraftData(this.bot.version);
    this.params = [
      {
        name: 'itemName',
        type: 'string',
        description: 'クラフトしたいアイテム名',
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

      // レシピを検索
      const recipes = this.bot.recipesFor(item.id, null, 1, null);

      if (recipes.length === 0) {
        return {
          success: true,
          result: `${itemName}のクラフトレシピは存在しません（入手方法: 採掘、モブドロップなど）`,
        };
      }

      // 最初のレシピを取得
      const recipe = recipes[0];
      const ingredients: string[] = [];

      // 必要な材料をリスト化
      if (recipe.delta) {
        for (const [itemId, count] of Object.entries(recipe.delta)) {
          if (Number(count) < 0) {
            const ingredientItem = this.mcData.items[itemId];
            if (ingredientItem) {
              ingredients.push(
                `${ingredientItem.name} x${Math.abs(Number(count))}`
              );
            }
          }
        }
      }

      // クラフトテーブルが必要かチェック
      const requiresCraftingTable =
        recipe.requiresTable || ingredients.length > 4;

      return {
        success: true,
        result: `${itemName}のレシピ: ${ingredients.join(', ')}${
          requiresCraftingTable ? ' (クラフトテーブル必要)' : ''
        }`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `レシピ確認エラー: ${error.message}`,
      };
    }
  }
}

export default CheckRecipe;

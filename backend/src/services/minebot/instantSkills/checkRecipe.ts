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

  /**
   * 材料IDを名前に変換（配列の場合は全選択肢を表示、木材系は任意表記）
   */
  private getIngredientName(ingredientId: any): string | null {
    if (ingredientId === null || ingredientId === -1) {
      return null;
    }

    // 配列の場合は全ての選択肢を表示
    if (Array.isArray(ingredientId)) {
      const names = ingredientId
        .filter((id: any) => id !== null && id !== -1)
        .map((id: any) => this.mcData.items[id]?.name)
        .filter((name: string | undefined) => name);

      if (names.length === 0) return null;
      if (names.length === 1) {
        // 単一でも木材系なら注釈追加
        return this.addWoodNote(names[0]);
      }
      // 複数選択肢がある場合は最初の3つ + "等"
      if (names.length > 3) {
        return `${names.slice(0, 3).join('/')}等`;
      }
      return names.join('/');
    }

    // 単一の場合
    const item = this.mcData.items[ingredientId];
    if (!item) return null;
    return this.addWoodNote(item.name);
  }

  /**
   * 木材系アイテムに注釈を追加（pale_oak_planks → pale_oak_planks(任意のplanks可)）
   */
  private addWoodNote(name: string): string {
    const woodTypes = [
      'oak',
      'spruce',
      'birch',
      'jungle',
      'acacia',
      'dark_oak',
      'mangrove',
      'cherry',
      'bamboo',
      'crimson',
      'warped',
      'pale_oak',
    ];
    const woodSuffixes = ['_planks', '_log', '_wood', '_slab', '_stairs'];

    for (const suffix of woodSuffixes) {
      if (name.endsWith(suffix)) {
        for (const woodType of woodTypes) {
          if (name.startsWith(woodType)) {
            return `${name}(任意の${suffix.slice(1)}可)`;
          }
        }
      }
    }
    return name;
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

      // minecraft-dataから直接レシピを取得
      const allRecipes = this.mcData.recipes[item.id];

      if (!allRecipes || allRecipes.length === 0) {
        return {
          success: true,
          result: `${itemName}のクラフトレシピは存在しません（入手方法: 採掘、モブドロップなど）`,
        };
      }

      // 全てのレシピを処理
      const recipeDescriptions: string[] = [];

      for (let i = 0; i < allRecipes.length; i++) {
        const recipe = allRecipes[i];
        const ingredientCounts: { [key: string]: number } = {};
        let requiresCraftingTable = false;

        // レシピの形式に応じて材料を抽出
        if (recipe.inShape) {
          // 形あり（shaped）レシピ
          const flatShape = recipe.inShape.flat();

          for (const ingredientId of flatShape) {
            const name = this.getIngredientName(ingredientId);
            if (name) {
              ingredientCounts[name] = (ingredientCounts[name] || 0) + 1;
            }
          }

          // 3x3以上のレシピはクラフトテーブルが必要
          if (
            recipe.inShape.length > 2 ||
            (recipe.inShape[0] && recipe.inShape[0].length > 2)
          ) {
            requiresCraftingTable = true;
          }
        } else if (recipe.ingredients) {
          // 形なし（shapeless）レシピ
          for (const ingredientId of recipe.ingredients) {
            const name = this.getIngredientName(ingredientId);
            if (name) {
              ingredientCounts[name] = (ingredientCounts[name] || 0) + 1;
            }
          }

          // 4個以上の材料はクラフトテーブルが必要
          if (recipe.ingredients.length > 4) {
            requiresCraftingTable = true;
          }
        }

        const ingredients = Object.entries(ingredientCounts).map(
          ([name, count]) => `${name} x${count}`
        );

        if (ingredients.length > 0) {
          const craftingNote = requiresCraftingTable
            ? ' (クラフトテーブル必要)'
            : '';
          recipeDescriptions.push(`${ingredients.join(', ')}${craftingNote}`);
        }
      }

      // 重複を除去（同じ材料構成のレシピを統合）
      const uniqueRecipes = [...new Set(recipeDescriptions)];

      if (uniqueRecipes.length === 0) {
        return {
          success: true,
          result: `${itemName}のクラフトレシピは存在しません`,
        };
      }

      if (uniqueRecipes.length === 1) {
        return {
          success: true,
          result: `${itemName}のレシピ: ${uniqueRecipes[0]}`,
        };
      }

      // 複数レシピがある場合は番号付きで表示
      const formattedRecipes = uniqueRecipes.map(
        (r, idx) => `[${idx + 1}] ${r}`
      );
      return {
        success: true,
        result: `${itemName}のレシピ（${
          uniqueRecipes.length
        }種類）:\n${formattedRecipes.join('\n')}`,
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

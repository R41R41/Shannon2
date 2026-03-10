import minecraftData from 'minecraft-data';
import { CustomBot, InstantSkill } from '../types.js';
import { createLogger } from '../../../utils/logger.js';
const log = createLogger('Minebot:Skill:craftOne');

/**
 * 原子的スキル: アイテムを1個クラフト
 */
class CraftOne extends InstantSkill {
  private mcData: any;

  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'craft-one';
    this.description = '指定アイテムをクラフトします。countで一度に複数個クラフトできます。';
    this.mcData = minecraftData(this.bot.version);
    this.params = [
      {
        name: 'itemName',
        type: 'string',
        description: 'クラフトするアイテム名',
        required: true,
      },
      {
        name: 'count',
        type: 'number',
        description: 'クラフトする個数（デフォルト: 1）',
        default: 1,
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

    if (Array.isArray(ingredientId)) {
      const names = ingredientId
        .filter((id: any) => id !== null && id !== -1)
        .map((id: any) => this.mcData.items[id]?.name)
        .filter((name: string | undefined) => name);

      if (names.length === 0) return null;
      if (names.length === 1) {
        return this.addWoodNote(names[0]);
      }
      if (names.length > 3) {
        return `${names.slice(0, 3).join('/')}等`;
      }
      return names.join('/');
    }

    const item = this.mcData.items[ingredientId];
    if (!item) return null;
    return this.addWoodNote(item.name);
  }

  /**
   * 木材系アイテムに注釈を追加
   */
  /**
   * 材料不足時に、インベントリの素材で作れる代替アイテムを提案する
   */
  private suggestAlternatives(itemName: string, inventoryItems: any[]): string | null {
    const woodTypes = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'bamboo', 'crimson', 'warped', 'pale_oak'];
    const woodSuffixes = ['_planks', '_slab', '_stairs', '_fence', '_door', '_button', '_pressure_plate', '_sign', '_boat'];

    for (const suffix of woodSuffixes) {
      if (!itemName.endsWith(suffix)) continue;

      const availableLogs = inventoryItems
        .filter((i: any) => i.name.endsWith('_log') || i.name.endsWith('_wood') || i.name.endsWith('_stem'))
        .map((i: any) => {
          const woodType = woodTypes.find(wt => i.name.startsWith(wt)) || i.name.replace(/_log$|_wood$|_stem$/, '');
          return { logName: i.name, count: i.count, woodType };
        });

      const availablePlanks = inventoryItems
        .filter((i: any) => i.name.endsWith('_planks'))
        .map((i: any) => ({ name: i.name, count: i.count }));

      const suggestions: string[] = [];

      for (const plank of availablePlanks) {
        const altName = plank.name.replace('_planks', '') + suffix;
        if (this.mcData.itemsByName[altName] && altName !== itemName) {
          suggestions.push(`${altName}（${plank.name} x${plank.count} あり）`);
        }
      }

      for (const log of availableLogs) {
        const plankName = `${log.woodType}_planks`;
        const altName = log.woodType + suffix;
        if (this.mcData.itemsByName[altName] && altName !== itemName) {
          suggestions.push(`${altName}（${log.logName} x${log.count} から ${plankName} を作成可能）`);
        }
      }

      if (suggestions.length > 0) return suggestions.slice(0, 3).join(', ');
    }

    return null;
  }

  private addWoodNote(name: string): string {
    const woodTypes = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'bamboo', 'crimson', 'warped', 'pale_oak'];
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

  async runImpl(itemName: string, count: number = 1) {
    try {
      // 開いているGUIを閉じる（activate-blockで開いたクラフトテーブルなど）
      if (this.bot.currentWindow) {
        log.debug('🔧 開いているウィンドウを閉じます');
        this.bot.closeWindow(this.bot.currentWindow);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const item = this.mcData.itemsByName[itemName];
      if (!item) {
        const allItems = Object.keys(this.mcData.itemsByName);
        const suggestions = allItems
          .filter((name: string) => name.includes(itemName.replace('wooden_', '').replace('_planks', '')))
          .slice(0, 5);

        let hint = '';
        if (itemName.includes('plank')) {
          hint = ' ヒント: planksは木の種類を指定する必要があります（例: oak_planks, birch_planks, spruce_planks）';
        }

        return {
          success: false,
          result: `アイテム${itemName}が見つかりません。${suggestions.length > 0 ? `類似: ${suggestions.join(', ')}` : ''}${hint}`,
        };
      }

      // minecraft-dataからレシピを確認
      const allRecipes = this.mcData.recipes[item.id];
      let requiresCraftingTable = false;

      if (allRecipes && allRecipes.length > 0) {
        const recipe = allRecipes[0];
        if (recipe.inShape) {
          if (recipe.inShape.length > 2 || (recipe.inShape[0] && recipe.inShape[0].length > 2)) {
            requiresCraftingTable = true;
          }
        } else if (recipe.ingredients && recipe.ingredients.length > 4) {
          requiresCraftingTable = true;
        }
      }

      // クラフトテーブルを探す
      const craftingTable = this.bot.findBlock({
        matching: this.mcData.blocksByName.crafting_table?.id,
        maxDistance: 4,
      });

      if (requiresCraftingTable && !craftingTable) {
        return {
          success: false,
          result: `${itemName}のクラフトにはクラフトテーブルが必要です。activate-blockでクラフトテーブルを使用するか、place-block-atで設置してください`,
        };
      }

      const craftCount = Math.max(1, Math.min(count, 64));

      // レシピを取得
      let recipes = this.bot.recipesFor(item.id, null, craftCount, craftingTable);

      if (recipes.length === 0) {
        if (allRecipes && allRecipes.length > 0) {
          const inventory = this.bot.inventory.items()
            .map((i: any) => `${i.name}x${i.count}`)
            .join(', ') || 'なし';

          // 全レシピの材料パターンを取得
          const recipePatterns: string[] = [];

          for (const recipe of allRecipes) {
            const ingredientCounts: { [key: string]: number } = {};

            if (recipe.inShape) {
              for (const row of recipe.inShape) {
                for (const id of row) {
                  const name = this.getIngredientName(id);
                  if (name) {
                    ingredientCounts[name] = (ingredientCounts[name] || 0) + 1;
                  }
                }
              }
            } else if (recipe.ingredients) {
              for (const id of recipe.ingredients) {
                const name = this.getIngredientName(id);
                if (name) {
                  ingredientCounts[name] = (ingredientCounts[name] || 0) + 1;
                }
              }
            }

            const pattern = Object.entries(ingredientCounts)
              .map(([n, c]) => `${n} x${c}`)
              .join(' + ');

            if (pattern && !recipePatterns.includes(pattern)) {
              recipePatterns.push(pattern);
            }
          }

          const requiredMaterials = recipePatterns.length > 0
            ? recipePatterns.join(' or ')
            : '不明';

          const alternatives = this.suggestAlternatives(itemName, this.bot.inventory.items());
          return {
            success: false,
            result: `${itemName}のクラフトに必要な材料が不足。` +
              `必要: ${requiredMaterials}。` +
              `現在のインベントリ: ${inventory}。` +
              (alternatives ? ` 代替案: ${alternatives}` : ''),
          };
        }
        return {
          success: false,
          result: `${itemName}のクラフトレシピが存在しません`,
        };
      }

      const recipe = recipes[0];

      // クラフト前のアイテム数を記録
      const beforeCount = this.bot.inventory.items()
        .filter((i: any) => i.name === itemName)
        .reduce((sum: number, i: any) => sum + i.count, 0);

      // クラフト実行
      await this.bot.craft(recipe, craftCount, craftingTable || undefined);

      // 少し待ってからインベントリを確認
      await new Promise(resolve => setTimeout(resolve, 100));

      // クラフト後のアイテム数を確認
      const afterCount = this.bot.inventory.items()
        .filter((i: any) => i.name === itemName)
        .reduce((sum: number, i: any) => sum + i.count, 0);

      const crafted = afterCount - beforeCount;
      if (crafted > 0) {
        return {
          success: true,
          result: `${itemName}を${crafted}個クラフトしました（${beforeCount}→${afterCount}個）`,
        };
      } else {
        return {
          success: false,
          result: `${itemName}のクラフトに失敗しました（インベントリに追加されていません）`,
        };
      }
    } catch (error: any) {
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

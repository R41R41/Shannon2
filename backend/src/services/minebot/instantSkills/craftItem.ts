import minecraftData from 'minecraft-data';
import pathfinder from 'mineflayer-pathfinder';
import { CustomBot, InstantSkill } from '../types.js';
const { goals } = pathfinder;

class CraftItem extends InstantSkill {
  private mcData: any;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'craft-item';
    this.description =
      '指定されたアイテムを作業台で作成します。素材になるアイテムを持っていない場合、インベントリをチェックしてそのアイテムを先に用意する必要があります。レシピの取得に失敗する場合は、自分が正しい材料を持っているか確認してください。';
    this.status = false;
    this.mcData = minecraftData(this.bot.version);
    this.params = [
      {
        name: 'itemName',
        description:
          '作成するアイテムの名前を指定します。例: iron_pickaxe, diamond_helmet, など',
        type: 'string',
      },
      {
        name: 'amount',
        description: '作成するアイテムの数量',
        type: 'number',
      },
    ];
  }

  async runImpl(itemName: string, amount: number) {
    console.log('craftItem', itemName);
    try {
      const item = this.mcData.itemsByName[itemName];
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (!item) {
        return {
          success: false,
          result: `アイテム ${itemName} が見つかりませんでした`,
        };
      }
      // 2x2レシピ
      const recipes2x2 = this.bot.recipesFor(item.id, null, null, false);
      let recipe,
        craftingTable = undefined;
      if (recipes2x2.length > 0) {
        recipe = recipes2x2[0];
      } else {
        craftingTable = this.bot.findBlock({
          matching: this.mcData.blocksByName.crafting_table.id,
          maxDistance: 64,
        });
        if (!craftingTable) {
          return {
            success: false,
            result: '近くに作業台が見つかりませんでした',
          };
        }
        await this.bot.pathfinder.goto(
          new goals.GoalNear(
            craftingTable.position.x,
            craftingTable.position.y,
            craftingTable.position.z,
            3
          )
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        const recipes = this.bot.recipesFor(item.id, null, null, craftingTable);
        if (!recipes || recipes.length === 0) {
          return {
            success: false,
            result: `アイテム ${itemName} のレシピが見つかりませんでした`,
          };
        }
        recipe = recipes[0];
      }

      // 1回で作れる最大数
      const maxPerCraft = recipe.result.count;
      let remaining = amount;
      while (remaining > 0) {
        const craftAmount = Math.min(remaining, maxPerCraft);
        try {
          await this.bot.craft(recipe, 1, craftingTable);
        } catch (err: any) {
          return {
            success: false,
            result: `クラフト中にエラー: ${
              err.message || err
            } 現在のインベントリに${itemName}が${this.getItemCount(
              itemName
            )}個あります。`,
          };
        }
        remaining -= craftAmount;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const total = this.getItemCount(itemName);
      if (total >= amount) {
        return {
          success: true,
          result: `${itemName}を${amount}個作成しました`,
        };
      }
      return {
        success: false,
        result: `${itemName}を作成できませんでした。現在のインベントリに${itemName}が${total}個あります。`,
      };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }

  getItemCount(itemName: string) {
    const items = this.bot.inventory
      .items()
      .filter((item) => item.name === itemName);
    return items.reduce((sum, i) => sum + i.count, 0);
  }
}

export default CraftItem;

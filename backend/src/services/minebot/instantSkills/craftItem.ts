import { InstantSkill, CustomBot } from '../types.js';
import pathfinder from 'mineflayer-pathfinder';
const { goals } = pathfinder;
import minecraftData from 'minecraft-data';

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

  async run(itemName: string, amount: number) {
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
      const recipes2x2 = this.bot.recipesFor(item.id, null, null, false);
      if (recipes2x2.length > 0) {
        await this.bot.craft(recipes2x2[0], amount, undefined);
      } else {
        const craftingTable = this.bot.findBlock({
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
        const recipe = this.bot.recipesFor(
          item.id,
          null,
          null,
          craftingTable
        )[0];
        if (!recipe) {
          return {
            success: false,
            result: `アイテム ${itemName} のレシピが見つかりませんでした`,
          };
        }
        await this.bot.craft(recipe, amount, craftingTable);
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
      const items = this.bot.inventory
        .items()
        .filter((item) => item.name === itemName);
      if (items && items.length >= amount) {
        return {
          success: true,
          result: `${itemName}を${amount}個作成しました`,
        };
      }
      return { success: false, result: `${itemName}を作成できませんでした` };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default CraftItem;

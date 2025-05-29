import { CustomBot, InstantSkill } from '../types.js';
import pathfinder from 'mineflayer-pathfinder';
const { goals, Movements } = pathfinder;
import minecraftData from 'minecraft-data';
import { Bot } from 'mineflayer';

class CollectBlock extends InstantSkill {
  private mcData: any;
  private searchDistance: number;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'collect-block';
    this.description =
      '指定したブロックを壊して指定されたアイテムを集めます。正しいブロック名とアイテム名を指定してください（例：blockName: stone, itemName: cobblestone, count: 10）';
    this.status = false;
    this.mcData = minecraftData(this.bot.version);
    this.searchDistance = 256;
    this.params = [
      {
        name: 'blockName',
        description:
          '壊すブロックの名前を指定します。例: stone, iron_ore, など    ',
        type: 'string',
      },
      {
        name: 'itemName',
        description:
          '破壊して拾うアイテムの名前を指定します。nullの場合は自動で拾うアイテムを選択します。例: cobblestone, raw_iron, など',
        type: 'string',
      },
      {
        name: 'count',
        description: '集めるブロックの個数',
        type: 'number',
      },
    ];
  }

  // 適切なツールを選択して装備する関数
  private async equipBestTool(block: any) {
    try {
      // ブロックに最適なツールを見つける
      const tool = this.bot.pathfinder.bestHarvestTool(block);
      if (tool) {
        await this.bot.equip(tool, 'hand');
        return true;
      }
      // 特定のツールがない場合は、インベントリ内の任意のツールを試す
      const possibleTools = this.bot.inventory
        .items()
        .filter(
          (item) =>
            item.name.includes('_pickaxe') ||
            item.name.includes('_axe') ||
            item.name.includes('_shovel') ||
            item.name.includes('_hoe') ||
            item.name.includes('shears')
        );

      if (possibleTools.length > 0) {
        await this.bot.equip(possibleTools[0], 'hand');
        return true;
      }
      return false;
    } catch (error) {
      console.error('ツールの装備に失敗しました:', error);
      return false;
    }
  }

  async run(blockName: string, itemName: string, count: number) {
    console.log('collectBlock', blockName, count);
    try {
      const Block = this.mcData.blocksByName[blockName];
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (!Block) {
        return { success: false, result: `ブロック${blockName}はありません` };
      }
      let dropItemName;
      if (itemName) {
        dropItemName = itemName;
      } else {
        const item = this.bot.registry.items[Block.drops[0]];
        dropItemName = item.name;
      }
      let collectItems = this.bot.inventory
        .items()
        .filter((item) => item.name === dropItemName);
      let collectCount = collectItems.reduce(
        (acc, item) => acc + item.count,
        0
      );
      while (collectCount < count) {
        const Blocks = this.bot.findBlocks({
          matching: Block.id,
          maxDistance: this.searchDistance,
          count: 1,
        });
        if (Blocks.length === 0) {
          return {
            success: false,
            result: `ブロック ${blockName} が見つかりませんでした`,
          };
        }
        const block = this.bot.blockAt(Blocks[0]);
        if (!block) {
          return {
            success: false,
            result: `ブロック ${blockName} が見つかりませんでした`,
          };
        }
        await this.bot.pathfinder.goto(
          new goals.GoalNear(Blocks[0].x, Blocks[0].y, Blocks[0].z, 3)
        );

        // ブロックを掘る前に最適なツールを装備
        await this.equipBestTool(block);

        await this.bot.dig(block);
        await new Promise((resolve) => setTimeout(resolve, 1000)); // ブロックがドロップするのを待つ
        const items = this.bot.nearestEntity(
          (entity) => entity.name === dropItemName
        );
        if (items) {
          // タイムアウト処理
          const timeout = 60000;
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('移動タイムアウト')), timeout);
          });

          // 目標への移動
          const goal = new goals.GoalNear(
            items.position.x,
            items.position.y,
            items.position.z,
            0.5
          );
          const movePromise = this.bot.pathfinder.goto(goal);

          await Promise.race([movePromise, timeoutPromise]);
        }
        collectItems = this.bot.inventory
          .items()
          .filter((item) => item.name === dropItemName);
        collectCount = collectItems.reduce((acc, item) => acc + item.count, 0);
      }
      return { success: true, result: `${blockName}を${count}個集めました。` };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default CollectBlock;

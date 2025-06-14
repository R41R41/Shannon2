import minecraftData from 'minecraft-data';
import pathfinder from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';
import HoldItem from './holdItem.js';
import SearchAndGotoBlock from './searchAndGotoBlock.js';
const { goals } = pathfinder;

class CollectBlock extends InstantSkill {
  private mcData: any;
  private searchDistance: number;
  private holdItem: HoldItem;
  private searchAndGotoBlock: SearchAndGotoBlock;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'collect-block';
    this.description = 'ブロックを壊して指定されたアイテムを集めます。';
    this.status = false;
    this.mcData = minecraftData(this.bot.version);
    this.searchDistance = 64;
    this.searchAndGotoBlock = new SearchAndGotoBlock(bot);
    this.params = [
      {
        name: 'itemName',
        description:
          '集めたいアイテムの名前を指定します。例: cobblestone, raw_iron, dirt, など',
        type: 'string',
      },
      {
        name: 'count',
        description: '集めるブロックの個数',
        type: 'number',
      },
    ];
    this.holdItem = new HoldItem(bot);
  }

  private getBlocksDroppingItem(itemName: string) {
    // アイテムIDを取得
    const item = this.mcData.itemsByName[itemName];
    if (!item) return [];
    const itemId = item.id;
    // 全ブロックを走査
    const result = [];
    const blocks: any[] = Object.values(this.mcData.blocksByName);
    for (const block of blocks) {
      if (!block.drops) continue;
      // dropsの型に両対応
      const dropIds = block.drops.map((d: any) =>
        typeof d === 'number'
          ? d
          : typeof d.drop === 'number'
            ? d.drop
            : d.drop.id
      );
      if (dropIds.includes(itemId)) {
        result.push(block);
      }
    }
    return result;
  }

  async runImpl(itemName: string, count: number) {
    console.log('collectBlock', itemName, count);
    try {
      const blocks = this.getBlocksDroppingItem(itemName);
      if (blocks.length === 0) {
        return {
          success: false,
          result: `アイテム${itemName}をドロップするブロックが見つかりませんでした`,
        };
      }
      let collected = 0;
      let failCount = 0;
      while (collected < count) {
        const Blocks: Vec3[] = [];
        for (const block of blocks) {
          const targetBlocks = this.bot.findBlocks({
            matching: block.id,
            maxDistance: this.searchDistance,
            count: 1,
          });
          Blocks.push(...targetBlocks);
        }
        if (Blocks.length === 0) {
          return {
            success: false,
            result: `ブロック ${blocks
              .map((block) => block.name)
              .join(', ')} が見つかりませんでした`,
          };
        }
        Blocks.sort((a, b) => {
          const distanceA = this.bot.entity.position.distanceTo(a);
          const distanceB = this.bot.entity.position.distanceTo(b);
          return distanceA - distanceB;
        });
        const block = this.bot.blockAt(Blocks[0]);
        if (!block) {
          return {
            success: false,
            result: `ブロック ${blocks
              .map((block) => block.name)
              .join(', ')} が見つかりませんでした.`,
          };
        }
        await this.searchAndGotoBlock.run(block.name, Blocks[0]);

        const toolIds = block.harvestTools
          ? Object.keys(block.harvestTools).map(Number)
          : [];
        const hasTool = this.bot.inventory
          .items()
          .some((item) => toolIds.includes(item.type));
        if (!hasTool && block.harvestTools !== undefined) {
          return {
            success: false,
            result: `掘るためのツールがインベントリにありません。`,
          };
        }
        const bestTool = this.bot.pathfinder.bestHarvestTool(block);
        if (bestTool) {
          await this.holdItem.run(bestTool.name);
        }

        await this.bot.dig(block);
        await new Promise((resolve) => setTimeout(resolve, 1000)); // ブロックがドロップするのを待つ
        // 新たに拾った数をカウント
        const before = collected;
        // 近くのドロップアイテムを拾う
        const items = this.bot.nearestEntity(
          (entity) => entity.name === itemName
        );
        if (items) {
          const timeout = 60000;
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('移動タイムアウト')), timeout);
          });
          const goal = new goals.GoalNear(
            items.position.x,
            items.position.y,
            items.position.z,
            0.5
          );
          const movePromise = this.bot.pathfinder.goto(goal);
          await Promise.race([movePromise, timeoutPromise]);
        }
        // インベントリの増加分をカウント
        const after = this.bot.inventory
          .items()
          .filter((item) => item.name === itemName)
          .reduce((acc, item) => acc + item.count, 0);
        // 新たに集めた数を計算
        const gained = after - before;
        collected += gained > 0 ? gained : 1; // 最低1個は増えたとみなす
        if (collected === before) {
          failCount++;
        } else {
          failCount = 0;
        }
        if (failCount >= 10) {
          return {
            success: false,
            result: `10回連続でアイテムが得られなかったため停止します。`,
          };
        }
      }
      return {
        success: true,
        result: `${itemName}を新たに${count}個集めました。`,
      };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default CollectBlock;

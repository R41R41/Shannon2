import minecraftData from 'minecraft-data';
import pathfinder from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';
const { goals } = pathfinder;

class SearchAndGotoBlock extends InstantSkill {
  private mcData: any;
  private searchDistance: number;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'search-and-goto-block';
    this.description = '指定されたブロックまたは座標を探索してその位置に移動します。ブロックの検知だけではなく移動が必要な場合のみに使用してください。';
    this.status = false;
    this.mcData = minecraftData(this.bot.version);
    this.searchDistance = 64;
    this.params = [
      {
        name: 'blockName',
        description:
          '探索するブロックの名前。例: iron_ore, acacia_log, crafting_tableなど',
        type: 'string',
        default: null,
      },
      {
        name: 'coordinate',
        description: '探索する座標',
        type: 'Vec3',
        default: null,
      },
    ];
  }

  async runImpl(blockName: string, coordinate: Vec3) {
    console.log('searchBlock', blockName, coordinate);
    try {
      if (coordinate) {
        const goal = new goals.GoalNear(
          coordinate.x,
          coordinate.y,
          coordinate.z,
          1
        );
        const movePromise = this.bot.pathfinder.goto(goal);
        await movePromise;
        return { success: true, result: `座標${coordinate.x} ${coordinate.y} ${coordinate.z}に移動しました。` };
      }
      const Block = this.mcData.blocksByName[blockName];
      if (!Block) {
        return { success: false, result: `ブロック${blockName}はありません` };
      }
      const Blocks = await this.bot.findBlocks({
        matching: Block.id,
        maxDistance: this.searchDistance,
        count: 1,
      });
      if (Blocks.length === 0) {
        return {
          success: false,
          result: `周囲${this.searchDistance}ブロック以内に${blockName}は見つかりませんでした`,
        };
      }

      const block = this.bot.blockAt(Blocks[0]);
      if (!block) {
        return {
          success: false,
          result: `ブロック${blockName}は見つかりませんでした`,
        };
      }
      const targetPos = new Vec3(block.position.x, block.position.y, block.position.z);
      // 到達を試行する関数
      const attemptToReachGoal = async (
        remainingAttempts = 3,
        timeout = 30000
      ) => {
        try {
          console.log(
            `${blockName}へ到達を試みています... 残り試行回数: ${remainingAttempts}`
          );

          // タイムアウト処理
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('移動タイムアウト')), timeout);
          });

          // 目標への移動
          const goal = new goals.GoalNear(
            targetPos.x,
            targetPos.y,
            targetPos.z,
            1
          );
          const movePromise = this.bot.pathfinder.goto(goal);

          await Promise.race([movePromise, timeoutPromise]);
          return {
            success: true,
            result: `${blockName}は${targetPos.x} ${targetPos.y} ${targetPos.z}にあります。`,
          };
        } catch (moveError: any) {
          console.log(`到達試行中にエラー: ${moveError.message}`);

          // 現在位置と目標の距離を確認
          const currentPos = this.bot.entity.position;
          const distance = currentPos.distanceTo(targetPos);

          // 十分近い場合（3ブロック以内）は成功と見なす
          if (distance <= 3) {
            return {
              success: true,
              result: `${blockName}は${targetPos.x} ${targetPos.y} ${targetPos.z
                }にあります。目標変更エラーが発生しましたが、十分に近づけました（距離: ${distance.toFixed(
                  2
                )}ブロック）。`,
            };
          }

          // 再試行回数が残っている場合は再試行
          if (remainingAttempts > 1) {
            console.log(`再試行します... 距離: ${distance.toFixed(2)}ブロック`);
            // 一時停止してから再試行
            await new Promise((resolve) => setTimeout(resolve, 1000));
            return attemptToReachGoal(remainingAttempts - 1, timeout);
          } else {
            console.log('search-and-goto-block error:', moveError);
            return {
              success: false,
              result: `${blockName}へ到達できませんでした。最終距離: ${distance.toFixed(
                2
              )}ブロック`,
            };
          }
        }
      };

      // 到達試行を開始
      return await attemptToReachGoal(3);
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default SearchAndGotoBlock;

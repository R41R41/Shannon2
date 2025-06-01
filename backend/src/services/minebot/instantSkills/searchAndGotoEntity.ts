import { CustomBot, InstantSkill } from '../types.js';
import pathfinder from 'mineflayer-pathfinder';
const { goals, Movements } = pathfinder;
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import { Bot } from 'mineflayer';

class SearchAndGotoEntity extends InstantSkill {
  private mcData: any;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'search-and-goto-entity';
    this.description =
      '指定されたエンティティを探索してその位置に移動します。プレイヤーの場合は、プレイヤーの元に向かう際などに使います。経験値オーブを拾う際などにも使います。';
    this.status = false;
    this.mcData = minecraftData(this.bot.version);
    this.params = [
      {
        name: 'entityName',
        description:
          '探索するエンティティの名前。例: zombie, spider, creeper, R41R41(player),経験値オーブ(experience_orb)など',
        type: 'string',
      },
    ];
  }

  async runImpl(entityName: string) {
    console.log('searchEntity', entityName);
    try {
      const Entities = this.bot.utils.getNearestEntitiesByName(
        this.bot,
        entityName
      );
      if (Entities.length === 0) {
        return {
          success: false,
          result: `周囲64ブロック以内に${entityName}は見つかりませんでした`,
        };
      }

      const targetPos = new Vec3(
        Entities[0].position.x,
        Entities[0].position.y,
        Entities[0].position.z
      );

      console.log('targetPos', targetPos);

      // 到達を試行する関数
      const attemptToReachGoal = async (
        remainingAttempts = 10,
        timeout = 60000
      ) => {
        try {
          console.log(
            `${entityName}へ到達を試みています... 残り試行回数: ${remainingAttempts}`
          );
          // 目標への移動
          const goal = new goals.GoalNear(
            targetPos.x,
            targetPos.y,
            targetPos.z,
            1
          );
          await this.bot.pathfinder.goto(goal);
          const currentPos = this.bot.entity.position;
          const distance = currentPos.distanceTo(targetPos);

          // 十分近い場合（3ブロック以内）は成功と見なす
          if (distance <= 3) {
            return {
              success: true,
              result: `${entityName}は${targetPos.x} ${targetPos.y} ${targetPos.z
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
            return {
              success: false,
              result: `${entityName}へ到達できませんでした。最終距離: ${distance.toFixed(
                2
              )}ブロック`,
            };
          }
        } catch (moveError: any) {
          console.log(`到達試行中にエラー: ${moveError.message}`);

          // 現在位置と目標の距離を確認
          const currentPos = this.bot.entity.position;
          const distance = currentPos.distanceTo(targetPos);

          // 十分近い場合（3ブロック以内）は成功と見なす
          if (distance <= 3) {
            return {
              success: true,
              result: `${entityName}は${targetPos.x} ${targetPos.y} ${targetPos.z
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
              result: `${entityName}へ到達できませんでした。最終距離: ${distance.toFixed(
                2
              )}ブロック`,
            };
          }
        }
      };

      // 到達試行を開始（上限10回）
      return await attemptToReachGoal(10);
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default SearchAndGotoEntity;

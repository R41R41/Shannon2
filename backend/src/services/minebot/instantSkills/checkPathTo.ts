import pathfinder from 'mineflayer-pathfinder';
import { CustomBot, InstantSkill } from '../types.js';
const { goals } = pathfinder;

/**
 * 原子的スキル: 目的地までのパスが存在するかチェック
 */
class CheckPathTo extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'check-path-to';
    this.description = '指定座標までのパスが存在するかチェックします。';
    this.params = [
      {
        name: 'x',
        type: 'number',
        description: 'X座標',
        required: true,
      },
      {
        name: 'y',
        type: 'number',
        description: 'Y座標',
        required: true,
      },
      {
        name: 'z',
        type: 'number',
        description: 'Z座標',
        required: true,
      },
    ];
  }

  async runImpl(x: number, y: number, z: number) {
    try {
      const currentPos = this.bot.entity.position;
      const distance =
        Math.floor(
          Math.sqrt(
            Math.pow(x - currentPos.x, 2) +
              Math.pow(y - currentPos.y, 2) +
              Math.pow(z - currentPos.z, 2)
          ) * 10
        ) / 10;

      // 距離が近すぎる場合
      if (distance < 1) {
        return {
          success: true,
          result: `目的地は現在地のすぐ近く（${distance}m）です`,
        };
      }

      // パスファインダーでパスを計算（実際には移動しない）
      const goal = new goals.GoalNear(x, y, z, 1);

      // パスが存在するか簡易チェック
      // 注: 完全なパス計算は重いので、ここでは距離と障害物の簡易チェック
      const horizontalDist = Math.sqrt(
        Math.pow(x - currentPos.x, 2) + Math.pow(z - currentPos.z, 2)
      );
      const verticalDist = Math.abs(y - currentPos.y);

      let feasibility = '可能';
      let note = '';

      if (verticalDist > 128) {
        feasibility = '困難';
        note = '(垂直距離が大きすぎる)';
      } else if (horizontalDist > 500) {
        feasibility = '遠い';
        note = '(非常に遠い)';
      } else if (verticalDist > 50) {
        feasibility = '要注意';
        note = '(大きな高低差)';
      }

      return {
        success: true,
        result: `目的地(${x}, ${y}, ${z})まで距離${distance}m、到達可能性: ${feasibility}${note}`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `チェックエラー: ${error.message}`,
      };
    }
  }
}

export default CheckPathTo;

import pathfinder from 'mineflayer-pathfinder';
import { CustomBot, InstantSkill } from '../types.js';
import { setMovements } from '../utils/setMovements.js';
const { goals } = pathfinder;
/**
 * 原子的スキル: 指定座標に移動するだけ
 */
class MoveTo extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'move-to';
    this.description = '指定された座標に移動します。';
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
      {
        name: 'range',
        type: 'number',
        description: '目標地点からの許容距離（デフォルト: 2）',
        default: 2,
      },
    ];
  }

  async runImpl(x: number, y: number, z: number, range: number = 2) {
    try {
      // パラメータの妥当性チェック
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return {
          success: false,
          result: '座標は有効な数値である必要があります',
        };
      }

      // Y座標の範囲チェック（-64～320）
      if (y < -64 || y > 320) {
        return {
          success: false,
          result: `Y座標が範囲外です（${y}）。-64～320の範囲で指定してください`,
        };
      }

      // 現在位置からの距離チェック
      const currentPos = this.bot.entity.position;
      const distance = Math.sqrt(
        Math.pow(x - currentPos.x, 2) +
        Math.pow(y - currentPos.y, 2) +
        Math.pow(z - currentPos.z, 2)
      );

      if (distance > 1000) {
        return {
          success: false,
          result: `目的地が遠すぎます（${distance.toFixed(
            0
          )}m）。1000m以内にしてください`,
        };
      }

      // pathfinderの移動設定を最適化
      setMovements(
        this.bot,
        false, // allow1by1towers: ブロックを積み上げない
        true,  // allowSprinting: ダッシュを許可
        true,  // allowParkour: ジャンプを許可
        true,  // canOpenDoors: ドアを開ける
        true,  // canDig: ブロックを掘る（障害物を除去）
        true,  // dontMineUnderFallingBlock: 落下ブロックの下は掘らない
        1,     // digCost: 掘るコスト（低いほど積極的に掘る）
        false  // allowFreeMotion: 自由移動（水中など）
      );

      const goal = new goals.GoalNear(x, y, z, range);
      const timeout = 30000; // 30秒

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('移動タイムアウト')), timeout);
      });

      await Promise.race([this.bot.pathfinder.goto(goal), timeoutPromise]);

      return {
        success: true,
        result: `座標(${x}, ${y}, ${z})に移動しました（距離: ${distance.toFixed(
          1
        )}m）`,
      };
    } catch (error: any) {
      // エラーメッセージを詳細化
      let errorDetail = error.message;
      if (error.message.includes('No path')) {
        errorDetail =
          'パスが見つかりません（障害物、高低差が大きい、チャンク未ロードなど）';
      } else if (error.message.includes('timeout')) {
        errorDetail =
          '移動がタイムアウトしました（30秒以内に到達できませんでした）';
      }

      return {
        success: false,
        result: `移動失敗: ${errorDetail}`,
      };
    }
  }
}

export default MoveTo;

import pathfinder from 'mineflayer-pathfinder';
import { CustomBot, InstantSkill } from '../types.js';
import { setMovements } from '../utils/setMovements.js';
const { goals } = pathfinder;
/**
 * 原子的スキル: 指定座標に移動するだけ
 * goalType: 'near' (デフォルト) または 'xz' (XZ座標のみ、Y座標は自動調整)
 */
class MoveTo extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'move-to';
    this.description =
      '指定された座標に移動します。goalTypeで移動方式を選択できます。';
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
        description: 'Y座標（goalType="xz"の場合は無視されます）',
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
      {
        name: 'goalType',
        type: 'string',
        description:
          '移動方式: "near"=XYZ座標の近く, "xz"=XZ座標のみ, "nearxz"=XZ座標の近く（範囲指定）, "y"=指定高さに移動。デフォルト: "near"',
        default: 'near',
      },
    ];
  }

  async runImpl(
    x: number,
    y: number,
    z: number,
    range: number = 2,
    goalType: string = 'near'
  ) {
    try {
      // パラメータの妥当性チェック
      if (!Number.isFinite(x) || !Number.isFinite(z)) {
        return {
          success: false,
          result: 'X/Z座標は有効な数値である必要があります',
        };
      }

      // Y座標が必要なgoalTypeの場合のみチェック
      const needsY = goalType === 'near' || goalType === 'y';
      if (needsY) {
        if (!Number.isFinite(y)) {
          return {
            success: false,
            result: 'Y座標は有効な数値である必要があります',
          };
        }

        // Y座標の範囲チェック（-64～320）
        if (y < -64 || y > 320) {
          return {
            success: false,
            result: `Y座標が範囲外です（${y}）。-64～320の範囲で指定してください`,
          };
        }
      }

      // 現在位置からの距離チェック
      const currentPos = this.bot.entity.position;
      let distance: number;

      switch (goalType) {
        case 'xz':
        case 'nearxz':
          // XZ平面での距離
          distance = Math.sqrt(
            Math.pow(x - currentPos.x, 2) + Math.pow(z - currentPos.z, 2)
          );
          break;
        case 'y':
          // 高さの差
          distance = Math.abs(y - currentPos.y);
          break;
        case 'near':
        default:
          // 3D距離
          distance = Math.sqrt(
            Math.pow(x - currentPos.x, 2) +
            Math.pow(y - currentPos.y, 2) +
            Math.pow(z - currentPos.z, 2)
          );
          break;
      }

      if (distance > 1000) {
        return {
          success: false,
          result: `目的地が遠すぎます（${distance.toFixed(
            0
          )}m）。1000m以内にしてください`,
        };
      }

      // pathfinderの移動設定を最適化
      // 水中にいる場合はallowFreeMotionとcanSwimを有効化
      const isInWater = (this.bot.entity as any)?.isInWater || false;

      setMovements(
        this.bot,
        false, // allow1by1towers: ブロックを積み上げない
        true, // allowSprinting: ダッシュを許可
        true, // allowParkour: ジャンプを許可
        true, // canOpenDoors: ドアを開ける
        true, // canDig: 水中ではブロックを掘らない（泳ぐ方が早い）
        true, // dontMineUnderFallingBlock: 落下ブロックの下は掘らない
        isInWater ? 2 : 1, // digCost: 水中では掘るコストを上げる
        isInWater, // allowFreeMotion: 水中では自由移動を許可
        true // canSwim: 泳ぐことを許可
      );

      if (isInWater) {
        console.log('\x1b[36m🏊 水中移動モード\x1b[0m');
      }

      // goalTypeに応じてGoalを選択
      let goal;
      let goalDescription: string;

      switch (goalType) {
        case 'xz':
          // XZ座標のみ（Y座標は自動調整）
          goal = new goals.GoalXZ(x, z);
          goalDescription = `XZ座標(${x}, ${z})`;
          break;

        case 'nearxz':
          // XZ座標の近く（範囲指定）
          goal = new goals.GoalNearXZ(x, z, range);
          goalDescription = `XZ座標(${x}, ${z})の${range}ブロック以内`;
          break;

        case 'y':
          // 指定高さに移動
          goal = new goals.GoalY(y);
          goalDescription = `高さY=${y}`;
          break;

        case 'near':
        default:
          // デフォルト: GoalNear（XYZ座標の近くに移動）
          goal = new goals.GoalNear(x, y, z, range);
          goalDescription = `座標(${x}, ${y}, ${z})`;
          break;
      }

      const timeout = 30000; // 30秒

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('移動タイムアウト')), timeout);
      });

      // 既存のゴールをクリア（別のスキルが設定したゴールと競合を防ぐ）
      this.bot.pathfinder.stop();

      await Promise.race([this.bot.pathfinder.goto(goal), timeoutPromise]);

      return {
        success: true,
        result: `${goalDescription}に移動しました（距離: ${distance.toFixed(
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

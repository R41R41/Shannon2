import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 指定座標を見る、またはyaw/pitch角度で向きを設定
 *
 * mineflayer の yaw/pitch 規約 (bot.look に渡すラジアン値):
 *   yaw:   Math.atan2(-delta.x, -delta.z)
 *          0 = 北(Z-), π/2 = 西(X-), ±π = 南(Z+), -π/2 = 東(X+)
 *   pitch: Math.atan2(delta.y, groundDistance)
 *          +π/2 = 真上(Y+), 0 = 水平, -π/2 = 真下(Y-)
 */
class LookAt extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'look-at';
    this.description =
      '指定された座標の方向を向くか、yaw/pitch角度で直接向きを設定します。' +
      '方向指定: 北(Z-)=yaw 0, 東(X+)=yaw -90, 南(Z+)=yaw 180, 西(X-)=yaw 90。' +
      '上下: 真上(Y+)=pitch 90, 水平=pitch 0, 真下(Y-)=pitch -90。';
    this.params = [
      {
        name: 'x',
        type: 'number',
        description: 'X座標（yawを使う場合は省略可）',
      },
      {
        name: 'y',
        type: 'number',
        description: 'Y座標（yawを使う場合は省略可）',
      },
      {
        name: 'z',
        type: 'number',
        description: 'Z座標（yawを使う場合は省略可）',
      },
      {
        name: 'yaw',
        type: 'number',
        description:
          'yaw角度（度数）。水平方向: 北(Z-)=0, 東(X+)=-90, 南(Z+)=180/-180, 西(X-)=90。座標の代わりに使用可能。',
      },
      {
        name: 'pitch',
        type: 'number',
        description:
          'pitch角度（度数）。上下方向: 90=真上(Y+), 0=水平, -90=真下(Y-)。デフォルト=0',
      },
    ];
  }

  async runImpl(
    x?: number,
    y?: number,
    z?: number,
    yaw?: number,
    pitch?: number,
  ) {
    try {
      // yawが指定されている場合は角度で設定
      if (yaw !== undefined) {
        const yawRad = (yaw * Math.PI) / 180;
        const pitchRad = ((pitch || 0) * Math.PI) / 180;

        // force=true で即座に向きを変える
        await this.bot.look(yawRad, pitchRad, true);

        const dirName = this.yawToDirectionName(yaw);
        const pitchName = this.pitchToName(pitch || 0);

        return {
          success: true,
          result: `${dirName}${pitchName}を向きました (yaw=${yaw}°, pitch=${pitch || 0}°)`,
        };
      }

      // 座標が指定されている場合
      if (x !== undefined && y !== undefined && z !== undefined) {
        const targetPos = new Vec3(x, y, z);
        await this.bot.lookAt(targetPos, true);

        return {
          success: true,
          result: `座標(${x}, ${y}, ${z})の方向を向きました`,
        };
      }

      return {
        success: false,
        result:
          '座標(x, y, z)またはyaw角度を指定してください。例: {"x":10,"y":65,"z":20} または {"yaw":180} (南/Z+方向)',
      };
    } catch (error: any) {
      return {
        success: false,
        result: `視線移動失敗: ${error.message}`,
      };
    }
  }

  /**
   * mineflayer yaw → 方角名
   * 0°=北, 90°=西, 180°=南, -90°=東
   */
  private yawToDirectionName(yaw: number): string {
    // yawを0~360に正規化
    const normalized = ((yaw % 360) + 360) % 360;
    if (normalized >= 337.5 || normalized < 22.5) return '北(Z-)';
    if (normalized >= 22.5 && normalized < 67.5) return '北西';
    if (normalized >= 67.5 && normalized < 112.5) return '西(X-)';
    if (normalized >= 112.5 && normalized < 157.5) return '南西';
    if (normalized >= 157.5 && normalized < 202.5) return '南(Z+)';
    if (normalized >= 202.5 && normalized < 247.5) return '南東';
    if (normalized >= 247.5 && normalized < 292.5) return '東(X+)';
    if (normalized >= 292.5 && normalized < 337.5) return '北東';
    return `yaw=${yaw}°方向`;
  }

  /**
   * mineflayer pitch → 上下名
   * +90°=真上, 0°=水平, -90°=真下
   */
  private pitchToName(pitch: number): string {
    if (pitch >= 80) return '(真上)';
    if (pitch >= 30) return '(上方)';
    if (pitch <= -80) return '(真下)';
    if (pitch <= -30) return '(下方)';
    return '';
  }
}

export default LookAt;

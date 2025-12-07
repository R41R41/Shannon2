import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 指定座標を見る、またはyaw/pitch角度で向きを設定
 */
class LookAt extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'look-at';
    this.description =
      '指定された座標の方向を向くか、yaw/pitch角度で直接向きを設定します。座標(x,y,z)を指定するか、yaw角度を指定してください。';
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
          'yaw角度（度数）。水平方向の向き。南=0, 西=90, 北=180/-180, 東=-90。座標の代わりに使用可能。',
      },
      {
        name: 'pitch',
        type: 'number',
        description:
          'pitch角度（度数）。上下の向き。-90=真上, 0=水平, 90=真下。デフォルト=0',
      },
    ];
  }

  async runImpl(
    x?: number,
    y?: number,
    z?: number,
    yaw?: number,
    pitch?: number
  ) {
    try {
      // yawが指定されている場合は角度で設定
      if (yaw !== undefined) {
        const yawRad = (yaw * Math.PI) / 180;
        const pitchRad = ((pitch || 0) * Math.PI) / 180;

        await this.bot.look(yawRad, pitchRad, false);

        return {
          success: true,
          result: `yaw=${yaw}°, pitch=${pitch || 0}°の方向を向きました`,
        };
      }

      // 座標が指定されている場合
      if (x !== undefined && y !== undefined && z !== undefined) {
        const targetPos = new Vec3(x, y, z);
        await this.bot.lookAt(targetPos);

        return {
          success: true,
          result: `座標(${x}, ${y}, ${z})の方向を向きました`,
        };
      }

      return {
        success: false,
        result:
          '座標(x, y, z)またはyaw角度を指定してください。例: {"x":10,"y":65,"z":20} または {"yaw":90}',
      };
    } catch (error: any) {
      return {
        success: false,
        result: `視線移動失敗: ${error.message}`,
      };
    }
  }
}

export default LookAt;

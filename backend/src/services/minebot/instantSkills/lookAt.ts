import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 指定座標を見る
 */
class LookAt extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'look-at';
    this.description = '指定された座標の方向を向きます。';
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
      const targetPos = new Vec3(x, y, z);
      await this.bot.lookAt(targetPos);

      return {
        success: true,
        result: `座標(${x}, ${y}, ${z})の方向を向きました`,
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

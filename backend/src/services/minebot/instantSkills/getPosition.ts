import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 現在位置を確認
 */
class GetPosition extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'get-position';
    this.description = '現在の座標と向きを確認します。';
    this.params = [];
  }

  async runImpl() {
    try {
      const pos = this.bot.entity.position;
      const yaw = this.bot.entity.yaw;
      const pitch = this.bot.entity.pitch;

      // ヨー角から方角を計算
      const yawDegrees = (yaw * 180) / Math.PI;
      let direction = '';
      if (yawDegrees >= -45 && yawDegrees < 45) direction = '南';
      else if (yawDegrees >= 45 && yawDegrees < 135) direction = '西';
      else if (yawDegrees >= 135 || yawDegrees < -135) direction = '北';
      else direction = '東';

      return {
        success: true,
        result: `現在位置: (${Math.floor(pos.x)}, ${Math.floor(
          pos.y
        )}, ${Math.floor(pos.z)}), 向き: ${direction}`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `取得エラー: ${error.message}`,
      };
    }
  }
}

export default GetPosition;

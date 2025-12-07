import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 腕を振る
 */
class SwingArm extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'swing-arm';
    this.description = '腕を振ります。';
    this.params = [];
  }

  async runImpl() {
    try {
      await this.bot.swingArm('right');

      return {
        success: true,
        result: '腕を振りました',
      };
    } catch (error: any) {
      return {
        success: false,
        result: `腕振りエラー: ${error.message}`,
      };
    }
  }
}

export default SwingArm;

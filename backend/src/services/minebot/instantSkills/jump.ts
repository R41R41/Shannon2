import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: ジャンプする
 */
class Jump extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'jump';
    this.description = 'ジャンプします。';
    this.params = [];
  }

  async runImpl() {
    try {
      // 既にジャンプ中かチェック
      if (!this.bot.entity.onGround) {
        return {
          success: false,
          result: '空中にいるためジャンプできません',
        };
      }

      this.bot.setControlState('jump', true);
      await new Promise((resolve) => setTimeout(resolve, 100));
      this.bot.setControlState('jump', false);

      return {
        success: true,
        result: 'ジャンプしました',
      };
    } catch (error: any) {
      return {
        success: false,
        result: `ジャンプエラー: ${error.message}`,
      };
    }
  }
}

export default Jump;

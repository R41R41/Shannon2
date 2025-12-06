import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 移動を停止する
 * pathfinderの移動やfollow-entityなどを中断する
 */
class StopMovement extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'stop-movement';
    this.description =
      '現在の移動を停止します。追尾（follow-entity）や逃走（flee-from）も停止できます。';
    this.params = [];
  }

  async runImpl() {
    try {
      // pathfinderを停止
      if (this.bot.pathfinder) {
        this.bot.pathfinder.stop();
      }

      // 物理的な移動も停止
      this.bot.clearControlStates();

      return {
        success: true,
        result: '移動を停止しました',
      };
    } catch (error: any) {
      return {
        success: false,
        result: `停止エラー: ${error.message}`,
      };
    }
  }
}

export default StopMovement;

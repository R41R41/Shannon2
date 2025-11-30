import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 現在の体力を確認
 */
class GetHealth extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'get-health';
    this.description = '現在の体力と空腹度を確認します。';
    this.params = [];
  }

  async runImpl() {
    try {
      const health = this.bot.health;
      const food = this.bot.food;
      const foodSaturation = this.bot.foodSaturation;

      const healthPercent = Math.floor((health / 20) * 100);
      const foodPercent = Math.floor((food / 20) * 100);

      let status = '';
      if (health < 6) {
        status = '危険！';
      } else if (health < 10) {
        status = '注意';
      } else {
        status = '良好';
      }

      return {
        success: true,
        result: `体力: ${health}/20 (${healthPercent}%) [${status}], 空腹度: ${food}/20 (${foodPercent}%), 満腹度: ${foodSaturation.toFixed(
          1
        )}`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `取得エラー: ${error.message}`,
      };
    }
  }
}

export default GetHealth;

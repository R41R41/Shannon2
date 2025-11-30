import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 指定時間待機
 */
class WaitTime extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'wait-time';
    this.description = '指定されたミリ秒数待機します。';
    this.params = [
      {
        name: 'milliseconds',
        type: 'number',
        description: '待機時間（ミリ秒）',
        required: true,
      },
    ];
  }

  async runImpl(milliseconds: number) {
    try {
      await new Promise((resolve) => setTimeout(resolve, milliseconds));

      return {
        success: true,
        result: `${milliseconds}ms待機しました`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `待機エラー: ${error.message}`,
      };
    }
  }
}

export default WaitTime;

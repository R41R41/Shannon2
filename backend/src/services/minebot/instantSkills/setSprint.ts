import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: スプリント（ダッシュ）のON/OFF
 */
class SetSprint extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'set-sprint';
    this.description = 'スプリント（ダッシュ）のON/OFFを切り替えます。';
    this.params = [
      {
        name: 'enabled',
        type: 'boolean',
        description: 'true: スプリントON, false: スプリントOFF',
        required: true,
      },
    ];
  }

  async runImpl(enabled: boolean) {
    try {
      if (typeof enabled !== 'boolean') {
        return {
          success: false,
          result: 'enabledパラメータはtrue/falseで指定してください',
        };
      }

      // 空腹度が6以下の場合はスプリントできない
      if (enabled && this.bot.food <= 6) {
        return {
          success: false,
          result: '空腹度が低すぎてスプリントできません（空腹度: 6以下）',
        };
      }

      this.bot.setControlState('sprint', enabled);

      return {
        success: true,
        result: enabled
          ? 'スプリントをONにしました'
          : 'スプリントをOFFにしました',
      };
    } catch (error: any) {
      return {
        success: false,
        result: `スプリント切り替えエラー: ${error.message}`,
      };
    }
  }
}

export default SetSprint;

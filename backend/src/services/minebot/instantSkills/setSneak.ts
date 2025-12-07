import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: スニーク（しゃがみ）のON/OFF
 */
class SetSneak extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'set-sneak';
    this.description = 'スニーク（しゃがみ）のON/OFFを切り替えます。';
    this.params = [
      {
        name: 'enabled',
        type: 'boolean',
        description: 'true: スニークON, false: スニークOFF',
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

      this.bot.setControlState('sneak', enabled);

      return {
        success: true,
        result: enabled ? 'スニークをONにしました' : 'スニークをOFFにしました',
      };
    } catch (error: any) {
      return {
        success: false,
        result: `スニーク切り替えエラー: ${error.message}`,
      };
    }
  }
}

export default SetSneak;

import { CustomBot, InstantSkill } from '../types.js';

export class SwitchAutoAvoidProjectileRange extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'switch-auto-avoid-projectile-range';
    this.description = 'スケルトンなどの射撃範囲の自動回避を有効/無効にします';
    this.priority = 10;
    this.params = [
      {
        name: 'enable',
        type: 'boolean',
        description: '自動回避を有効にするかどうか',
        default: true,
      },
    ];
  }

  async run(enable: boolean) {
    try {
      const skill = this.bot.constantSkills.getSkill(
        'auto-avoid-projectile-range'
      );
      if (!skill) {
        return { success: false, result: 'スキルが見つからない' };
      }
      skill.status = enable;
      return {
        success: true,
        result: `射撃範囲の自動回避を${enable ? '有効' : '無効'}にしました`,
      };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default SwitchAutoAvoidProjectileRange;

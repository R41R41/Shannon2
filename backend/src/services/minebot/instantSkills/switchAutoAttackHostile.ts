import { CustomBot, InstantSkill } from '../types.js';

export class SwitchAutoAttackHostile extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'switch-auto-attack-hostile';
    this.description = '敵対的なモンスターに対して自動攻撃を有効/無効にします';
    this.priority = 10;
    this.params = [
      {
        name: 'enable',
        type: 'boolean',
        description: '自動攻撃を有効にするかどうか',
        default: true,
      },
    ];
  }

  async runImpl(enable: boolean) {
    console.log('switchAutoAttackHostile', enable);
    try {
      const skill = this.bot.constantSkills.getSkill('auto-attack-hostile');
      if (!skill) {
        return { success: false, result: 'スキルが見つからない' };
      }
      skill.status = enable;
      return {
        success: true,
        result: `自動攻撃を${enable ? '有効' : '無効'}にしました`,
      };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default SwitchAutoAttackHostile;

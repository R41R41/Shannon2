import { CustomBot, InstantSkill } from '../types.js';

export class SwitchAutoEat extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'switch-auto-eat';
    this.description = '自動で食べる';
    this.priority = 10;
    this.params = [
      {
        name: 'enable',
        type: 'boolean',
        description: '自動で食べるを有効にするかどうか',
        default: true,
      },
    ];
  }

  async runImpl(enable: boolean) {
    console.log('switchAutoEat', enable);
    try {
      const skill = this.bot.constantSkills.getSkill('auto-eat');
      if (!skill) {
        return { success: false, result: 'スキルが見つからない' };
      }
      skill.status = enable;
      return {
        success: true,
        result: `自動で食べるを${enable ? '有効' : '無効'}にしました`,
      };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default SwitchAutoEat;

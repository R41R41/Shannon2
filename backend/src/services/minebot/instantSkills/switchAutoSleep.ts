import { CustomBot, InstantSkill } from '../types.js';

export class SwitchAutoSleep extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'switch-auto-sleep';
    this.description = '夜になったら自動で寝る機能を有効/無効にします';
    this.priority = 10;
    this.params = [
      {
        name: 'enable',
        type: 'boolean',
        description: '夜になったら自動で寝る機能を有効にするかどうか',
        default: true,
      },
    ];
  }

  async run(enable: boolean) {
    console.log('switchAutoSleep', enable);
    try {
      const skill = this.bot.constantSkills.getSkill('auto-sleep');
      if (!skill) {
        return { success: false, result: 'スキルが見つからない' };
      }
      skill.status = enable;
      return {
        success: true,
        result: `自動で寝る機能を${enable ? '有効' : '無効'}にしました`,
      };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default SwitchAutoSleep;

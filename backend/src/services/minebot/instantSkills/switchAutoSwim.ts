import { CustomBot, InstantSkill } from '../types.js';

export class SwitchAutoSwim extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'switch-auto-swim';
    this.description = '水中に入ったら自動で泳ぐ機能を有効/無効にします';
    this.priority = 10;
    this.params = [
      {
        name: 'enable',
        type: 'boolean',
        description: '水中に入ったら自動で泳ぐ機能を有効にするかどうか',
        default: true,
      },
    ];
  }

  async run(enable: boolean) {
    console.log('switchAutoSwim', enable);
    try {
      const skill = this.bot.constantSkills.getSkill('auto-swim');
      if (!skill) {
        return { success: false, result: 'スキルが見つからない' };
      }
      skill.status = enable;
      return {
        success: true,
        result: `水中に入ったら自動で泳ぐ機能を${
          enable ? '有効' : '無効'
        }にしました`,
      };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default SwitchAutoSwim;

import { CustomBot, InstantSkill } from '../types.js';

export class SwitchAutoRunFromHostile extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'switch-auto-run-from-hostile';
    this.description = '敵モブから自動で逃げる機能を有効/無効にします';
    this.priority = 10;
    this.params = [
      {
        name: 'enable',
        type: 'boolean',
        description: '敵モブから自動で逃げる機能を有効にするかどうか',
        default: true,
      },
    ];
  }

  async run(enable: boolean) {
    console.log('switchAutoRunFromHostile', enable);
    try {
      const skill = this.bot.constantSkills.getSkill('auto-run-from-hostile');
      if (!skill) {
        return { success: false, result: 'スキルが見つからない' };
      }
      skill.status = enable;
      return {
        success: true,
        result: `敵モブから自動で逃げる機能を${
          enable ? '有効' : '無効'
        }にしました`,
      };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default SwitchAutoRunFromHostile;

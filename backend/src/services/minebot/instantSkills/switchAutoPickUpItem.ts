import { CustomBot, InstantSkill } from '../types.js';

export class SwitchAutoPickUpItem extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'switch-auto-pick-up-item';
    this.description = '落ちているアイテムの自動収集を有効/無効にします';
    this.priority = 10;
    this.params = [
      {
        name: 'enable',
        type: 'boolean',
        description: '落ちているアイテムの自動収集を有効にするかどうか',
        default: true,
      },
    ];
  }

  async run(enable: boolean) {
    console.log('switchAutoPickUpItem', enable);
    try {
      const skill = this.bot.constantSkills.getSkill('auto-pick-up-item');
      if (!skill) {
        return { success: false, result: 'スキルが見つからない' };
      }
      skill.status = enable;
      return {
        success: true,
        result: `落ちているアイテムの自動収集を${
          enable ? '有効' : '無効'
        }にしました`,
      };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default SwitchAutoPickUpItem;

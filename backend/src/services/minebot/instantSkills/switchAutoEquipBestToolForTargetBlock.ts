import { CustomBot, InstantSkill } from '../types.js';

export class SwitchAutoEquipBestToolForTargetBlock extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'switch-auto-equip-best-tool-for-target-block';
    this.description =
      'ブロックに対する最適なツールの自動選択を有効/無効にします';
    this.priority = 10;
    this.params = [
      {
        name: 'enable',
        type: 'boolean',
        description:
          'ブロックに対する最適なツールの自動選択を有効にするかどうか',
        default: true,
      },
    ];
  }

  async run(enable: boolean) {
    console.log('switchAutoEquipBestToolForTargetBlock', enable);
    try {
      const skill = this.bot.constantSkills.getSkill(
        'auto-equip-best-tool-for-target-block'
      );
      if (!skill) {
        return { success: false, result: 'スキルが見つからない' };
      }
      skill.status = enable;
      return {
        success: true,
        result: `ブロックに対する最適なツールの自動選択を${
          enable ? '有効' : '無効'
        }にしました`,
      };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default SwitchAutoEquipBestToolForTargetBlock;

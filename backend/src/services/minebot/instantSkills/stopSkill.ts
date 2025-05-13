import { CustomBot, InstantSkill } from '../types.js';

export class StopSkill extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'stop-skill';
    this.description = '指定したスキルを停止します';
    this.priority = 10;
    this.params = [
      {
        name: 'skillName',
        type: 'string',
        description: '停止するスキルの名前',
        default: null,
      },
    ];
  }

  async run(skillName: string) {
    console.log('stopSkill', skillName);
    try {
      const skill = this.bot.instantSkills.getSkill(skillName);
      if (!skill) {
        return { success: false, result: 'スキルが見つからない' };
      }
      skill.status = false;
      return { success: true, result: 'スキルを停止しました' };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default StopSkill;

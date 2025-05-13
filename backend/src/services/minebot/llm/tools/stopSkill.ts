import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { CustomBot } from '../../types.js';

export default class StopSkillTool extends StructuredTool {
  name = 'stop-skill';
  description = 'スキルを停止するツール。';
  schema = z.object({
    skillName: z.string().describe('停止するスキルの名前'),
  });
  private bot: CustomBot;
  constructor(bot: CustomBot) {
    super();
    this.bot = bot;
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      const skill = this.bot.instantSkills.getSkill(data.skillName);
      if (skill) {
        skill.status = false;
        return `${data.skillName}を停止しました。`;
      } else {
        return `${data.skillName}は存在しません。`;
      }
    } catch (error) {
      console.error('Stop skill error:', error);
      return `An error occurred while stopping skill: ${error}`;
    }
  }
}

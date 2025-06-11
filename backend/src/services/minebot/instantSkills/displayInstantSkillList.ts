import { CustomBot, InstantSkill } from '../types.js';

class DisplayInstantSkillList extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'display-instant-skill-list';
    this.description = 'Instant Skillのリストを表示します。';
    this.priority = 100;
    this.params = [];
    this.isToolForLLM = false;
  }

  async runImpl(): Promise<{
    success: boolean;
    result: string;
  }> {
    try {
      if (this.bot.instantSkills === null) {
        return { success: false, result: 'スキルリストが指定されていません' };
      }
      for (const skill of this.bot.instantSkills.getSkills()) {
        const message = JSON.stringify({
          text: `${skill.skillName}`,
          color: `${skill.status ? 'green' : 'gray'}`,
          underlined: true,
          hoverEvent: {
            action: 'show_text',
            contents: `${skill.description}`,
          },
          clickEvent: {
            action: 'suggest_command',
            value: `./${skill.skillName}`,
          },
        });
        await this.bot.chat(`/tellraw @a ${message}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return { success: true, result: 'Instant Skillのリストを表示しました' };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default DisplayInstantSkillList;

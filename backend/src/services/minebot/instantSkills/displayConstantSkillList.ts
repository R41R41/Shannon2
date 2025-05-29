import { CustomBot, InstantSkill } from '../types.js';

class DisplayConstantSkillList extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'display-constant-skill-list';
    this.description = 'Constant Skillのリストを表示します。';
    this.priority = 100;
    this.params = [];
    this.isToolForLLM = false;
  }

  async run(): Promise<{
    success: boolean;
    result: string;
  }> {
    try {
      if (this.bot.constantSkills === null) {
        return { success: false, result: 'スキルリストが指定されていません' };
      }
      this.bot.constantSkills.getSkills().forEach(async (skill) => {
        const message = JSON.stringify({
          text: `${skill.skillName}`,
          color: `${skill.status ? 'blue' : 'gray'}`,
          underlined: true,
          hoverEvent: {
            action: 'show_text',
            contents: `${skill.description}`,
          },
          clickEvent: {
            action: 'suggest_command',
            value: `../${skill.skillName}`,
          },
        });
        await this.bot.chat(`/tellraw @a ${message}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
        console.log(message);
      });
      return { success: true, result: 'Constant Skillのリストを表示しました' };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default DisplayConstantSkillList;

import { CustomBot, InstantSkill } from '../types.js';

class DisplayBotStatus extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'display-bot-status';
    this.description = 'ボットの体力と満腹度を表示します。';
    this.status = false;
    this.params = [];
  }

  async run(): Promise<{
    success: boolean;
    result: string;
  }> {
    try {
      const hpMessage = JSON.stringify({
        text: `HP ${this.bot.health.toFixed(1)}/20`,
        color: 'green',
      });
      const foodMessage = JSON.stringify({
        text: `Food ${this.bot.food.toFixed(1)}/20`,
        color: 'green',
      });
      await this.bot.chat(`/tellraw @a ${hpMessage}`);
      await this.bot.chat(`/tellraw @a ${foodMessage}`);
      return { success: true, result: `botの体力と満腹度を表示しました` };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default DisplayBotStatus;

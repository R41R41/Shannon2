import { ConstantSkill, CustomBot } from '../types.js';
import AutoFollow from './autoFollow.js';

class AutoSwim extends ConstantSkill {
  private autoFollow: AutoFollow;
  private distance: number;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-swim';
    this.description = '自動で泳ぐ';
    this.interval = 1000;
    this.distance = 24;
    this.autoFollow = new AutoFollow(this.bot);
    this.status = true;
    this.priority = 8;
    this.containMovement = true;
  }

  async runImpl() {
    try {
      if (this.bot.isInWater) {
        await this.autoFollow.swim(null);
      }
    } catch (error) {
      console.log('autoSwim error', error);
    }
  }
}

export default AutoSwim;

import { CustomBot } from '../types.js';
import { ConstantSkill } from '../types.js';
import { FollowEntity } from '../instantSkills/followEntity.js';

class AutoSwim extends ConstantSkill {
  private followEntity: FollowEntity;
  private distance: number;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'autoSwim';
    this.description = '自動で泳ぐ';
    this.interval = 1000;
    this.distance = 24;
    this.followEntity = new FollowEntity(this.bot);
    this.status = true;
  }

  async run() {
    try {
      if (this.bot.isInWater) {
        await this.followEntity.swim(null);
      }
    } catch (error) {
      console.log('autoSwim error', error);
    }
  }
}

export default AutoSwim;

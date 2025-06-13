import { FollowEntity } from '../instantSkills/followEntity.js';
import { ConstantSkill, CustomBot } from '../types.js';

class AutoSwim extends ConstantSkill {
  private followEntity: FollowEntity;
  private distance: number;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-swim';
    this.description = '自動で泳ぐ';
    this.interval = 1000;
    this.distance = 24;
    this.followEntity = new FollowEntity(this.bot);
    this.status = true;
    this.priority = 8;
    this.containMovement = true;
  }

  async runImpl() {
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

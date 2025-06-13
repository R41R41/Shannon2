import FollowEntity from '../instantSkills/followEntity.js';
import { ConstantSkill, CustomBot } from '../types.js';

class AutoFollow extends ConstantSkill {
  private followEntity: FollowEntity;
  private lastStatus: boolean = false;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-follow';
    this.description = '自動で近くのプレイヤーを追尾する';
    this.isLocked = false;
    this.status = false;
    this.priority = 8;
    this.containMovement = true;
    this.followEntity = new FollowEntity(bot);
  }

  async runImpl() {}
}

export default AutoFollow;

import { ConstantSkill, CustomBot } from '../types.js';
import ShootAnArrow from '../instantSkills/shootItemToEntityOrBlockOrCoordinate.js';

class AutoShootArrowToBlock extends ConstantSkill {
  private shootAnArrow: ShootAnArrow;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-shoot-arrow-to-block';
    this.description = '自動で指定されたブロックに矢を撃ちます';
    this.interval = 5000;
    this.isLocked = false;
    this.status = false;
    this.args = { blockName: null };
    this.shootAnArrow = new ShootAnArrow(this.bot);
  }

  async run() {
    if (this.isLocked) {
      return;
    }
    if (!this.args.blockName) {
      return;
    }

    this.lock();
    this.shootAnArrow.run('arrow', null, this.args.blockName, null);
    this.unlock();
  }
}

export default AutoShootArrowToBlock;

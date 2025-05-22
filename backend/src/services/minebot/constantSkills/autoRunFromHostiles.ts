import { CustomBot, ConstantSkill } from '../types.js';

class AutoRunFromHostiles extends ConstantSkill {
  distance: number;
  radius: number;
  runIfFatal: boolean;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-run-from-hostiles';
    this.description = '自動で敵モブから逃げる';
    this.interval = 1000;
    this.distance = 16;
    this.radius = 32;
    this.runIfFatal = true;
    this.status = true;
  }

  async run() {
    const hostiles = Object.values(this.bot.entities).filter(
      (entity) =>
        entity.type === 'hostile' &&
        this.bot.entity.position.distanceTo(entity.position) <= this.distance
    );
    if (
      (!this.runIfFatal && hostiles.length > 0) ||
      (this.runIfFatal && this.bot.health <= 2)
    ) {
      await this.bot.utils.runFromEntities(this.bot, hostiles, this.radius);
    }
  }
}

export default AutoRunFromHostiles;

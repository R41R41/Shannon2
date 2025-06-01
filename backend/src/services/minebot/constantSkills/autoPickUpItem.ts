import { ConstantSkill, CustomBot } from '../types.js';
import type { Entity } from 'prismarine-entity';

class AutoPickUpItem extends ConstantSkill {
  private pickUpItemName: string;

  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-pick-up-item';
    this.description = '自動でアイテムを拾う';
    this.status = false;
    this.interval = 0;
    this.pickUpItemName = '';
  }

  async run(entity: Entity) {
    if (entity.displayName === 'Item') {
      let item = null;
      setTimeout(async () => {
        item = entity.getDroppedItem();
        if (!item) return;
        if (this.pickUpItemName) {
          if (this.pickUpItemName !== item.name) {
            return;
          }
        }
        // アイテムまでの距離を測定
        const distance = this.bot.entity.position.distanceTo(entity.position);
        if (distance > 16) {
          return;
        }
        if (distance > 2) {
          await this.bot.lookAt(entity.position);
          await this.bot.utils.goalFollow.run(entity, 1.5);
        }
        await this.bot.collectBlock.collect(entity);
      }, 100);
    }
  }
}

export default AutoPickUpItem;

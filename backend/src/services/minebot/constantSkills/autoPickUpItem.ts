import type { Entity } from 'prismarine-entity';
import { ConstantSkill, CustomBot } from '../types.js';

class AutoPickUpItem extends ConstantSkill {
  private pickUpItemName: string;

  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-pick-up-item';
    this.description = '自動でアイテムを拾う';
    this.status = true;
    this.interval = 1000;
    this.priority = 3;
    this.pickUpItemName = '';
    this.containMovement = true;
  }

  async runImpl(entity?: Entity) {
    if (!entity) {
      const entities = Object.values(this.bot.entities).filter(
        (entity) => entity.displayName === 'Item'
      );
      let item = null;
      for (const entity of entities) {
        item = entity.getDroppedItem();
        if (!item) continue;
        if (this.pickUpItemName) {
          if (this.pickUpItemName !== item.name) {
            continue;
          }
        }
        // アイテムまでの距離を測定
        const distance = this.bot.entity.position.distanceTo(entity.position);
        if (distance > 16) {
          continue;
        }
        if (distance > 2) {
          await this.bot.lookAt(entity.position);
          await this.bot.utils.goalFollow.run(entity, 1.5);
        }
        await this.bot.collectBlock.collect(entity);
      }
      return;
    }
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

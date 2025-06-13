import mcData from 'minecraft-data';
import { ConstantSkill, CustomBot } from '../types.js';

class AutoUpdateLookingAt extends ConstantSkill {
  private mcData: any;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-update-looking-at';
    this.description = 'lookingAtを更新します';
    this.interval = 1000;
    this.status = true;
    this.mcData = mcData(this.bot.version);
    this.priority = 10;
  }

  async runImpl() {
    const block = this.bot.blockAtCursor(8);
    const entity = this.bot.entityAtCursor(8);
    if (entity) {
      if (entity.name === 'item') {
        const meta = entity.metadata.find(
          (m) => m && typeof m === 'object' && 'itemId' in m
        );
        if (meta) {
          const itemId = meta.itemId;
          const itemName = this.mcData.items[itemId as number]?.name;
          this.bot.selfState.lookingAt = {
            isDroppedItem: true,
            name: itemName,
            position: entity.position ? entity.position : null,
            metadata: entity.metadata,
          };
        }
      } else {
        this.bot.selfState.lookingAt = entity;
      }
    } else if (block) {
      this.bot.selfState.lookingAt = block;
    } else {
      this.bot.selfState.lookingAt = null;
    }
  }
}

export default AutoUpdateLookingAt;

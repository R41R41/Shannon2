import minecraftData from 'minecraft-data';
import { ConstantSkill, CustomBot } from '../types.js';

class AutoDetectBlockOrEntity extends ConstantSkill {
  private mcData: any;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-detect-block-or-entity';
    this.description = 'ブロックやエンティティを自動で検知する';
    this.isLocked = false;
    this.priority = 10;
    this.status = false;
    this.interval = 1000;
    this.mcData = minecraftData(this.bot.version);
    this.args = { blockName: null, entityName: null, searchDistance: 64 };
  }

  async runImpl() {
    this.lock();
    if (this.args.blockName) {
      const Block = this.mcData.blocksByName[this.args.blockName];
      if (!Block) {
        this.bot.chat(`ブロック${this.args.blockName}はありません`);
      }
      const Blocks = this.bot.findBlocks({
        matching: Block.id,
        maxDistance: this.args.searchDistance,
        count: 1,
      });
      if (Blocks.length > 0) {
        this.bot.chat(
          `周囲${this.args.searchDistance}ブロック以内に${this.args.blockName}が見つかりました`
        );
        this.status = false;
      }
    }
    if (this.args.entityName) {
      const Entities = this.bot.utils.getNearestEntitiesByName(
        this.bot,
        this.args.entityName
      );
      if (Entities.length > 0) {
        this.bot.chat(
          `周囲${this.args.searchDistance}ブロック以内に${this.args.entityName}が見つかりました`
        );
        this.status = false;
      }
    }
    this.unlock();
  }
}

export default AutoDetectBlockOrEntity;

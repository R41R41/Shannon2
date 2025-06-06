import HoldItem from '../instantSkills/holdItem.js';
import { ConstantSkill, CustomBot } from '../types.js';

class AutoEquipBestToolForTargetBlock extends ConstantSkill {
  private holdItem: HoldItem;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-equip-best-tool-for-target-block';
    this.description = '掘削対象ブロックに最適なツールを装備する';
    this.isLocked = false;
    this.status = true;
    this.interval = 1000;
    this.holdItem = new HoldItem(bot);
  }

  async run() {
    try {
      // 掘削対象ブロックを取得
      const targetBlock = this.bot.targetDigBlock;
      if (!targetBlock) return;

      // 最適なツールを装備
      const bestTool = this.bot.pathfinder.bestHarvestTool(targetBlock);
      if (bestTool) {
        await this.holdItem.run(bestTool.name);
      }
      return;
    } catch (error) {
      console.error('ツール装備エラー:', error);
      return;
    }
  }
}

export default AutoEquipBestToolForTargetBlock;

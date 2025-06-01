import { ConstantSkill, CustomBot } from '../types.js';

class AutoEquipBestToolForTargetBlock extends ConstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-equip-best-tool-for-target-block';
    this.description = '掘削対象ブロックに最適なツールを装備する';
    this.isLocked = false;
    this.status = true;
    this.interval = 1000;
  }

  async run() {
    try {
      // 掘削対象ブロックを取得
      const targetBlock = this.bot.targetDigBlock;
      if (!targetBlock) return;

      // 最適なツールを装備
      await this.bot.tool.equipForBlock(targetBlock);
      return;
    } catch (error) {
      console.error('ツール装備エラー:', error);
      return;
    }
  }
}

export default AutoEquipBestToolForTargetBlock;

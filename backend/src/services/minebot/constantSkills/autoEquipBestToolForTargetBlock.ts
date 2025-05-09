import { ConstantSkill, CustomBot } from '../types.js';

class AutoEquipBestToolForTargetBlock extends ConstantSkill {
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'autoEquipBestToolForTargetBlock';
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

            // 最適なツールを選択
            const tool = this.bot.pathfinder.bestHarvestTool(targetBlock);
            if (!tool) return;

            // ツールを装備
            await this.bot.equip(tool, 'hand');
            return
        } catch (error) {
            console.error('ツール装備エラー:', error);
            return;
        }
    }
}

export default AutoEquipBestToolForTargetBlock;
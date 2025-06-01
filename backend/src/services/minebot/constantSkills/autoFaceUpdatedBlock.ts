import { ConstantSkill, CustomBot } from '../types.js';
import { Vec3 } from 'vec3';
import { Block } from 'prismarine-block';

class AutoFaceUpdatedBlock extends ConstantSkill {
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'auto-face-updated-block';
        this.description = '4ブロック以内のブロックが更新された場合に注目します';
        this.status = true;
        this.isLocked = false;
    }

    async run(block: Block) {
        if (this.isLocked) return;
        this.isLocked = true;
        const blockPos = new Vec3(
            block.position.x + 0.5,
            block.position.y + 0.5,
            block.position.z + 0.5
        );
        await this.bot.lookAt(blockPos);
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.isLocked = false;
    }
}

export default AutoFaceUpdatedBlock;

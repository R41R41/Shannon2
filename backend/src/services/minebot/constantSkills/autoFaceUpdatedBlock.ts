import { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { ConstantSkill, CustomBot } from '../types.js';

class AutoFaceUpdatedBlock extends ConstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-face-updated-block';
    this.description = '4ブロック以内のブロックが更新された場合に注目します';
    this.status = false;
    this.isLocked = false;
    this.priority = 2;
  }

  async runImpl(block: Block) {
    if (this.bot.executingSkill) return;
    if (this.isLocked) return;
    this.isLocked = true;
    const blockPos = new Vec3(
      block.position.x + 0.5,
      block.position.y + 0.5,
      block.position.z + 0.5
    );
    await this.bot.lookAt(blockPos);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    this.isLocked = false;
  }
}

export default AutoFaceUpdatedBlock;

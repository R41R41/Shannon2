import { Entity } from 'prismarine-entity';
import { Vec3 } from 'vec3';
import { ConstantSkill, CustomBot } from '../types.js';

class AutoFaceMovedEntity extends ConstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-face-moved-entity';
    this.description = 'エンティティが移動した場合に注目します';
    this.status = false;
    this.isLocked = false;
    this.priority = 2;
  }

  async runImpl(entity: Entity) {
    if (entity.name === 'item' && entity.onGround) return;
    if (this.bot.executingSkill) return;
    // エンティティの頭の位置を計算
    const headPos = new Vec3(
      entity.position.x,
      entity.position.y + (entity.height || 1.62),
      entity.position.z
    );
    await this.bot.lookAt(headPos);
    // ロックは親クラスのrun()が管理するため、ここでは待機のみ
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export default AutoFaceMovedEntity;

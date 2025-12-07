import { Vec3 } from 'vec3';
import { ConstantSkill, CustomBot } from '../types.js';

class AutoFaceNearestEntity extends ConstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-face-nearest-entity';
    this.description = '4ブロック以内にある最も近いエンティティに注目します';
    this.status = false;
    this.isLocked = false;
    this.interval = 1000;
    this.priority = 2;
  }

  async runImpl() {
    if (this.bot.executingSkill) return;
    const entities = Object.values(this.bot.entities)
      .filter((e) => e.id !== this.bot.entity.id)
      .filter((e) => this.bot.entity.position.distanceTo(e.position) <= 4);
    if (entities.length === 0) return;
    const nearest = entities.reduce((a, b) =>
      this.bot.entity.position.distanceTo(a.position) <
        this.bot.entity.position.distanceTo(b.position)
        ? a
        : b
    );
    // エンティティの頭の位置を計算
    const headPos = new Vec3(
      nearest.position.x,
      nearest.position.y + (nearest.height || 1.62),
      nearest.position.z
    );
    await this.bot.lookAt(headPos);
    // ロックは親クラスのrun()が管理するため、ここでは待機のみ
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export default AutoFaceNearestEntity;

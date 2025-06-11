import { Vec3 } from 'vec3';
import HoldItem from '../instantSkills/holdItem.js';
import ShootItemToEntityOrBlockOrCoordinate from '../instantSkills/shootItemToEntityOrBlockOrCoordinate.js';
import { ConstantSkill, CustomBot } from '../types.js';

class AutoThrowEnderPearl extends ConstantSkill {
  private holdItem: HoldItem;
  private shootItemToEntityOrBlockOrCoordinate: ShootItemToEntityOrBlockOrCoordinate;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-throw-ender-pearl';
    this.description =
      '落下死しそうな時に自動でエンダーパールを投げて落下ダメージを回避します';
    this.interval = 100;
    this.isLocked = false;
    this.status = false;
    this.holdItem = new HoldItem(this.bot);
    this.shootItemToEntityOrBlockOrCoordinate =
      new ShootItemToEntityOrBlockOrCoordinate(this.bot);
  }

  async run() {
    const pos = this.bot.entity.position;
    if (this.isLocked) return;
    if (this.bot.entity.velocity.y > -0.5) return;

    // 下方向に5ブロック以上空いているか判定
    let groundY = pos.y;
    for (let y = Math.floor(pos.y) - 1; y >= 0; y--) {
      const block = this.bot.blockAt(new Vec3(pos.x, y, pos.z));
      if (
        block &&
        block.boundingBox !== 'empty' &&
        block.name !== 'air' &&
        block.name !== 'cave_air'
      ) {
        groundY = y + 1;
        break;
      }
    }
    const fallDistance = pos.y - groundY;
    if (fallDistance < 5) return;
    const expectedDamage = Math.max(0, Math.floor(fallDistance - 3));
    if (this.bot.health > expectedDamage) return;
    const pearl = this.bot.inventory
      .items()
      .find((item) => item.name === 'ender_pearl');
    if (!pearl) return;

    this.lock();
    // 真下に投げる
    const targetPos = new Vec3(pos.x, groundY, pos.z);
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.shootItemToEntityOrBlockOrCoordinate.shootToCoordinate(
      targetPos,
      'ender_pearl'
    );
    await new Promise((resolve) => setTimeout(resolve, 500));

    this.unlock();
  }
}

export default AutoThrowEnderPearl;

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
    this.priority = 10;
  }

  async runImpl() {
    const pos = this.bot.entity.position;
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

    // 真下に向いてエンダーパールを直接投げる
    await this.holdItem.run('ender_pearl', false);
    // bot.lookAt は中心を向くので、自分の足元よりさらに下(3ブロック)を向かせる
    await this.bot.lookAt(new Vec3(pos.x, pos.y - 3, pos.z));

    // activateItem で右クリック（投擲）
    this.bot.deactivateItem(); // 念のため解除
    this.bot.activateItem();
    // 投げ終わるまで少し待機
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export default AutoThrowEnderPearl;

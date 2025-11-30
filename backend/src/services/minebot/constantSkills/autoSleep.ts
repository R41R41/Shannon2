import { goals } from 'mineflayer-pathfinder';
import { ConstantSkill, CustomBot } from '../types.js';

/**
 * 自動睡眠スキル
 * 夜になったら自動でベッドで寝る
 */
class AutoSleep extends ConstantSkill {
  private isSleeping: boolean = false;

  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-sleep';
    this.description = '夜になったら自動でベッドで寝ます';
    this.interval = 5000; // 5秒ごとにチェック
    this.isLocked = false;
    this.status = false;
    this.priority = 4;
  }

  async runImpl() {
    // 既に寝ている場合はスキップ
    if (this.isSleeping || this.bot.isSleeping) return;

    // 移動中はスキップ
    if (this.bot.pathfinder.isMoving()) return;

    // 夜かどうかチェック（時刻が13000-23000の間が夜）
    const timeOfDay = this.bot.time.timeOfDay;
    if (timeOfDay < 13000 || timeOfDay > 23000) return;

    // 近くのベッドを探す（32ブロック以内）
    const bed = this.bot.findBlock({
      matching: (block) =>
        block.name.includes('bed') && block.name !== 'bedrock',
      maxDistance: 32,
    });

    if (!bed) {
      console.log('\x1b[33m⚠ 近くにベッドが見つかりません\x1b[0m');
      return;
    }

    try {
      this.isSleeping = true;

      // ベッドに近づく
      const distance = this.bot.entity.position.distanceTo(bed.position);
      if (distance > 3) {
        console.log('\x1b[36mベッドに移動中...\x1b[0m');
        await this.bot.pathfinder.goto(
          new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2)
        );
      }

      // ベッドで寝る
      console.log('\x1b[36mベッドで寝ます...\x1b[0m');
      await this.bot.sleep(bed);
      console.log('\x1b[32m✓ ベッドで寝ました\x1b[0m');

      // 起きるまで待機
      await this.bot.waitForTicks(100);

      this.isSleeping = false;
    } catch (error) {
      this.isSleeping = false;
      console.log(
        `\x1b[33m⚠ 睡眠に失敗: ${
          error instanceof Error ? error.message : '不明なエラー'
        }\x1b[0m`
      );
    }
  }
}

export default AutoSleep;

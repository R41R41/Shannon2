import pathfinderPkg from 'mineflayer-pathfinder';
import { ConstantSkill, CustomBot } from '../types.js';

const { goals } = pathfinderPkg;

/**
 * 自動アイテム拾得スキル
 * 近くに落ちているアイテムを自動で拾う
 */
class AutoPickUpItem extends ConstantSkill {
  private pickupRadius: number = 8; // アイテムを拾う半径

  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-pick-up-item';
    this.description = '近くに落ちているアイテムを自動で拾います';
    this.interval = 1000; // 1秒ごとにチェック（taskPer1000msイベント使用）
    this.isLocked = false;
    this.status = false;
    this.priority = 3;
  }

  async runImpl(entity?: any) {
    // 移動中はスキップ
    if (this.bot.pathfinder.isMoving()) return;

    // entitySpawnイベントからの呼び出しは無視（定期実行のみで処理）
    // これにより、投げられた直後のアイテムに反応しない
    if (entity) return;

    // 定期実行の場合（0.5秒ごと）
    // 近くの静止しているアイテムを探す
    const items = Object.values(this.bot.entities).filter((e: any) => {
      if (e.name !== 'item') return false;

      const distance = e.position.distanceTo(this.bot.entity.position);
      if (distance > this.pickupRadius) return false;

      // 速度チェック：動いているアイテムは無視（投げられた直後のアイテム）
      if (e.velocity) {
        const speed = Math.sqrt(
          e.velocity.x ** 2 + e.velocity.y ** 2 + e.velocity.z ** 2
        );
        if (speed > 0.1) return false; // まだ動いている
      }

      return true;
    });

    if (items.length === 0) return;

    // インベントリがいっぱいかチェック
    if (this.bot.inventory.emptySlotCount() === 0) return;

    // 最も近いアイテムに移動
    const closestItem = items.reduce((closest: any, current: any) => {
      const closestDist = closest.position.distanceTo(this.bot.entity.position);
      const currentDist = current.position.distanceTo(this.bot.entity.position);
      return currentDist < closestDist ? current : closest;
    });

    const distance = this.bot.entity.position.distanceTo(closestItem.position);
    if (distance > 2) {
      try {
        await this.bot.pathfinder.goto(
          new goals.GoalNear(
            closestItem.position.x,
            closestItem.position.y,
            closestItem.position.z,
            1
          )
        );
      } catch (error) {
        // パスファインディング失敗は無視
        return;
      }
    }
  }
}

export default AutoPickUpItem;

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
    this.interval = 500; // 0.5秒ごとにチェック
    this.isLocked = false;
    this.status = false;
    this.priority = 3;
  }

  async runImpl(entity?: any) {
    // 移動中はスキップ
    if (this.bot.pathfinder.isMoving()) return;

    // entityが渡された場合（イベントからの呼び出し）
    if (entity) {
      // アイテムドロップのみ対象
      if (entity.name !== 'item') return;

      // 距離チェック
      const distance = this.bot.entity.position.distanceTo(entity.position);
      if (distance > this.pickupRadius) return;

      // インベントリがいっぱいかチェック
      if (this.bot.inventory.emptySlotCount() === 0) return;

      // アイテムに近づく（既に近い場合は何もしない）
      if (distance > 2) {
        try {
          await this.bot.pathfinder.goto(
            new goals.GoalNear(
              entity.position.x,
              entity.position.y,
              entity.position.z,
              1
            )
          );
        } catch (error) {
          // パスファインディング失敗は無視
          return;
        }
      }
    } else {
      // 定期実行の場合
      // 近くのアイテムを探す
      const items = Object.values(this.bot.entities).filter(
        (entity: any) =>
          entity.name === 'item' &&
          entity.position.distanceTo(this.bot.entity.position) <=
          this.pickupRadius
      );

      if (items.length === 0) return;

      // インベントリがいっぱいかチェック
      if (this.bot.inventory.emptySlotCount() === 0) return;

      // 最も近いアイテムに移動
      const closestItem = items.reduce((closest: any, current: any) => {
        const closestDist = closest.position.distanceTo(
          this.bot.entity.position
        );
        const currentDist = current.position.distanceTo(
          this.bot.entity.position
        );
        return currentDist < closestDist ? current : closest;
      });

      const distance = this.bot.entity.position.distanceTo(
        closestItem.position
      );
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
}

export default AutoPickUpItem;

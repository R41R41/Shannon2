import pkg from 'mineflayer-pathfinder';
import { Entity } from 'prismarine-entity';
import { Vec3 } from 'vec3';
import { CustomBot, ResponseType } from '../types.js';
const { goals } = pkg;

export class GoalDistanceEntity {
  bot: CustomBot;
  constructor(bot: CustomBot) {
    this.bot = bot;
  }
  async run(entity: Entity, distance: number): Promise<ResponseType> {
    if (!entity || !entity.position) {
      console.error('エンティティの位置情報が取得できません:', entity); // デバッグ情報を追加
      return {
        success: false,
        result: 'エンティティの位置情報が取得できません',
      };
    }
    const target = this.calcTargetPosition(
      this.bot.entity.position.x,
      this.bot.entity.position.z,
      entity.position.x,
      entity.position.z,
      distance
    );
    // entityの速度を考慮して目標地点を調整
    const entitySpeedX = entity.velocity.x;
    const entitySpeedZ = entity.velocity.z;

    const botSpeed = 2;
    const length = Math.sqrt(
      Math.pow(target.x - this.bot.entity.position.x, 2) +
        Math.pow(target.z - this.bot.entity.position.z, 2)
    );
    const timeToReach = length / botSpeed + 0.5;
    const entityPositionX = entity.position.x + entitySpeedX * timeToReach;
    const entityPositionZ = entity.position.z + entitySpeedZ * timeToReach;
    const adjustedTarget = this.calcTargetPosition(
      this.bot.entity.position.x,
      this.bot.entity.position.z,
      entityPositionX,
      entityPositionZ,
      distance
    );
    try {
      await this.bot.pathfinder.goto(
        new goals.GoalXZ(adjustedTarget.x, adjustedTarget.z)
      );
      return { success: true, result: 'ゴールに到達しました' };
    } catch (error) {
      console.error('Error in run:', error);
      return { success: false, result: 'ゴールに到達できませんでした' };
    }
  }

  calcTargetPosition(
    botX: number,
    botZ: number,
    entityX: number,
    entityZ: number,
    distance: number
  ): Vec3 {
    const dx = entityX - botX;
    const dz = entityZ - botZ;
    const length = Math.sqrt(dx * dx + dz * dz);
    const ratio = distance / length;
    return new Vec3(botX + dx * ratio, 0, botZ + dz * ratio);
  }
}

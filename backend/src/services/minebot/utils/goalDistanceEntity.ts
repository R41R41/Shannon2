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
  async run(entityId: number, distance: number): Promise<ResponseType> {
    const entity = this.bot.entities[entityId];
    if (!entity || !entity.position || !entity.velocity) {
      console.error('エンティティの位置情報が取得できません:', entity); // デバッグ情報を追加
      return {
        success: false,
        result: 'エンティティの位置情報が取得できません',
      };
    }
    // entityの速度を考慮して目標地点を計算
    const entitySpeedX = entity.velocity.x;
    const entitySpeedZ = entity.velocity.z;
    const botSpeed = 2;
    const adjustedTarget = this.calcTargetPositionWithVelocity(
      this.bot.entity.position.x,
      this.bot.entity.position.z,
      entity.position.x,
      entity.position.z,
      entitySpeedX,
      entitySpeedZ,
      distance,
      botSpeed
    );
    try {
      console.log(entity.name, adjustedTarget.x, adjustedTarget.z);
      if (isNaN(adjustedTarget.x) || isNaN(adjustedTarget.z)) {
        return {
          success: false,
          result: 'ゴールに到達できませんでした',
        };
      }
      await this.bot.pathfinder.goto(
        new goals.GoalXZ(adjustedTarget.x, adjustedTarget.z)
      );
      return { success: true, result: 'ゴールに到達しました' };
    } catch (error) {
      console.error('Error in run:', error);
      return { success: false, result: 'ゴールに到達できませんでした' };
    }
  }

  calcTargetPositionWithVelocity(
    botX: number,
    botZ: number,
    entityX: number,
    entityZ: number,
    entitySpeedX: number,
    entitySpeedZ: number,
    distance: number,
    botSpeed: number
  ): Vec3 {
    const dx = entityX - botX;
    const dz = entityZ - botZ;
    const vx = entitySpeedX;
    const vz = entitySpeedZ;
    console.log(dx, dz, vx, vz);

    // 速度がほぼ0なら現在位置を使う
    if (
      (Math.abs(vx) < 0.1 && Math.abs(vz) < 0.1) ||
      vx === undefined ||
      vz === undefined
    ) {
      // bot→entityのベクトルを計算
      const dx = botX - entityX;
      const dz = botZ - entityZ;
      const len = Math.sqrt(dx * dx + dz * dz);

      // 距離が0の場合は適当にX方向に逃がす
      if (len < 0.1) {
        return new Vec3(entityX + distance, 0, entityZ);
      }

      // 距離が正ならentityから離れる、負なら近づく
      const ratio = distance / len;
      return new Vec3(entityX + dx * ratio, 0, entityZ + dz * ratio);
    }

    const a = botSpeed * botSpeed - (vx * vx + vz * vz);
    const b = 2 * (dx * vx + dz * vz);
    const c = dx * dx + dz * dz - distance * distance;
    const D = b * b - 4 * a * c;
    if (D < 0 || Math.abs(a) < 0.1) {
      // 解なし、またはa=0で解けない場合は現在のentity位置を使う
      return new Vec3(entityX, 0, entityZ);
    }
    const t1 = (-b + Math.sqrt(D)) / (2 * a);
    const t2 = (-b - Math.sqrt(D)) / (2 * a);
    // tは正の値のみを採用
    const t = Math.max(t1, t2, 0);
    const ex = entityX + vx * t;
    const ez = entityZ + vz * t;
    const ddx = ex - botX;
    const ddz = ez - botZ;
    const len = Math.sqrt(ddx * ddx + ddz * ddz);
    if (len < 0.1 || distance < 0.1) {
      return new Vec3(botX, 0, botZ);
    }
    const ratio = distance / len;
    return new Vec3(botX + ddx * ratio, 0, botZ + ddz * ratio);
  }
}

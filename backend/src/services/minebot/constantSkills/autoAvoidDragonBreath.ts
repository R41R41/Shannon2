import { Vec3 } from 'vec3';
import { ConstantSkill, CustomBot } from '../types.js';

class AutoAvoidDragonBreath extends ConstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-avoid-dragon-breath';
    this.description = 'エンドラのブレスを検知して避けます';
    this.interval = 1000; // より頻繁にチェック
    this.isLocked = false;
    this.priority = 12; // 高い優先度で実行
    this.status = true;
    this.containMovement = true;
  }

  async runImpl() {
    try {
      // ---------------------------
      // 1. ドラゴンの火の玉（dragon_fireball）を回避
      // ---------------------------
      const botPos = this.bot.entity.position.clone();
      const fireballs = Object.values(this.bot.entities).filter(
        (e) => e.name === 'dragon_fireball'
      );

      for (const fireball of fireballs) {
        // fireball.velocity は Vec3 型
        const velocity = (fireball as any).velocity as Vec3 | undefined;
        if (!velocity) continue;

        // bot の高さに到達するまでの時間 t を計算 (単位: tick)
        // velocity.y が 0 または bot より上に向かう場合は無視
        if (velocity.y === 0) continue;
        const t = (botPos.y - fireball.position.y) / velocity.y;
        if (t <= 0) continue; // 既に通過済み or 上昇中

        // 予測衝突位置を算出
        const predictedPos = new Vec3(
          fireball.position.x + velocity.x * t,
          botPos.y, // 同じ高さに合わせる
          fireball.position.z + velocity.z * t
        );

        const horizontalDistance = Math.sqrt(
          Math.pow(predictedPos.x - botPos.x, 2) +
            Math.pow(predictedPos.z - botPos.z, 2)
        );

        // 8 ブロック以内に着弾する見込みなら回避
        if (horizontalDistance < 8) {
          console.log('ドラゴンの火の玉を検知。回避行動を取ります');
          await this.bot.utils.runFromEntities(this.bot, [fireball], 12);
          // 危険は一度回避したら他の火の玉は無視 (過剰反応防止)
          break;
        }
      }

      // ---------------------------
      // エンドラのブレスエフェクトを検索
      const dragonBreath = this.bot.nearestEntity(
        (entity) =>
          entity.name === 'area_effect_cloud' &&
          entity.position.distanceTo(this.bot.entity.position) <= 8 &&
          (entity.metadata[10] as any).type === 'dragon_breath'
      );

      if (!dragonBreath) {
        return;
      }

      // ブレスの位置を取得
      const breathPos = dragonBreath.position;
      const botPos2 = this.bot.entity.position;

      // ブレスからの距離を計算
      const distance = botPos2.distanceTo(breathPos);

      // ブレスが近すぎる場合（8ブロック以内）
      if (distance < 8) {
        await this.bot.utils.runFromEntities(this.bot, [dragonBreath], 12);
      }
    } catch (error: any) {
      console.error(`エンドラのブレス回避中にエラー: ${error.message}`);
    }
  }
}

export default AutoAvoidDragonBreath;

import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 最も近い敵に1回攻撃
 */
class AttackNearest extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'attack-nearest';
    this.description = '最も近い敵エンティティに1回攻撃します。';
    this.params = [
      {
        name: 'maxDistance',
        type: 'number',
        description: '攻撃可能な最大距離（デフォルト: 4.5ブロック）',
        default: 4.5,
      },
    ];
  }

  async runImpl(maxDistance: number = 4.5) {
    try {
      // 敵対的なMobのリスト
      const hostileMobs = [
        'zombie',
        'skeleton',
        'creeper',
        'spider',
        'enderman',
        'witch',
        'slime',
        'phantom',
        'blaze',
        'ghast',
        'zombified_piglin',
        'piglin',
        'hoglin',
        'wither_skeleton',
        'cave_spider',
        'silverfish',
        'guardian',
        'elder_guardian',
        'shulker',
        'vindicator',
        'evoker',
        'pillager',
        'ravager',
      ];

      // 最も近い敵を探す
      const enemy = this.bot.nearestEntity((entity) => {
        if (!entity || !entity.position) return false;

        const distance = entity.position.distanceTo(this.bot.entity.position);
        if (distance > maxDistance) return false;

        // 敵対的なMobかチェック
        const entityName = entity.name?.toLowerCase() || '';
        return hostileMobs.some((mob) => entityName.includes(mob));
      });

      if (!enemy) {
        return {
          success: false,
          result: `${maxDistance}ブロック以内に攻撃可能な敵が見つかりません`,
        };
      }

      const distance = enemy.position.distanceTo(this.bot.entity.position);

      // 距離が遠すぎる場合
      if (distance > 4.5) {
        return {
          success: false,
          result: `敵(${enemy.name})が遠すぎます（距離: ${distance.toFixed(
            1
          )}m）`,
        };
      }

      // 敵を見る
      await this.bot.lookAt(enemy.position.offset(0, enemy.height * 0.8, 0));

      // 攻撃
      await this.bot.attack(enemy);

      return {
        success: true,
        result: `${enemy.name}を攻撃しました（距離: ${distance.toFixed(1)}m）`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `攻撃エラー: ${error.message}`,
      };
    }
  }
}

export default AttackNearest;

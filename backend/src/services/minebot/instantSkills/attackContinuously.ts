import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 敵を連続で攻撃
 */
class AttackContinuously extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'attack-continuously';
    this.description = '最も近い敵を連続で攻撃します（最大回数指定可能）。';
    this.params = [
      {
        name: 'maxAttacks',
        type: 'number',
        description: '最大攻撃回数（デフォルト: 10回）',
        default: 10,
      },
      {
        name: 'maxDistance',
        type: 'number',
        description: '攻撃可能な最大距離（デフォルト: 4.5ブロック）',
        default: 4.5,
      },
    ];
  }

  async runImpl(maxAttacks: number = 10, maxDistance: number = 4.5) {
    try {
      // パラメータチェック
      if (maxAttacks < 1 || maxAttacks > 100) {
        return {
          success: false,
          result: '攻撃回数は1～100の範囲で指定してください',
        };
      }

      // 敵対的なMobのリスト
      const hostileMobs = [
        'zombie',
        'husk',           // ゾンビ亜種
        'drowned',        // 水中ゾンビ
        'skeleton',
        'stray',          // スケルトン亜種
        'creeper',
        'spider',
        'enderman',
        'witch',
        'slime',
        'magma_cube',
        'phantom',
        'blaze',
        'ghast',
        'zombified_piglin',
        'piglin',
        'piglin_brute',
        'hoglin',
        'zoglin',
        'wither_skeleton',
        'wither',
        'cave_spider',
        'silverfish',
        'endermite',
        'guardian',
        'elder_guardian',
        'shulker',
        'vindicator',
        'evoker',
        'vex',
        'pillager',
        'ravager',
        'warden',
      ];

      let attackCount = 0;
      let lastEnemyName = '';

      for (let i = 0; i < maxAttacks; i++) {
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
          if (attackCount === 0) {
            return {
              success: false,
              result: `${maxDistance}ブロック以内に攻撃可能な敵が見つかりません`,
            };
          }
          // 敵がいなくなったら終了
          break;
        }

        lastEnemyName = enemy.name || 'unknown';
        const distance = enemy.position.distanceTo(this.bot.entity.position);

        // 距離が遠すぎる場合
        if (distance > 4.5) {
          return {
            success: true,
            result: `${lastEnemyName}を${attackCount}回攻撃しましたが、敵が遠ざかりました（距離: ${distance.toFixed(
              1
            )}m）`,
          };
        }

        // 敵を見る
        await this.bot.lookAt(enemy.position.offset(0, enemy.height * 0.8, 0));

        // 攻撃
        await this.bot.attack(enemy);
        attackCount++;

        // 次の攻撃まで少し待つ（攻撃クールダウン）
        await new Promise((resolve) => setTimeout(resolve, 600));

        // 敵が死んだかチェック
        if (!enemy.isValid) {
          break;
        }
      }

      if (attackCount >= maxAttacks) {
        return {
          success: true,
          result: `${lastEnemyName}を${attackCount}回攻撃しました（最大回数到達）`,
        };
      }

      return {
        success: true,
        result: `${lastEnemyName}を${attackCount}回攻撃して倒しました`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `連続攻撃エラー: ${error.message}`,
      };
    }
  }
}

export default AttackContinuously;

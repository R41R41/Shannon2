import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: エンティティを連続で攻撃a
 */
class AttackContinuously extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'attack-continuously';
    this.description = '最も近いエンティティを連続で攻撃します。entityNameで対象を指定可能。省略時は敵対的Mobのみ。';
    this.params = [
      {
        name: 'entityName',
        type: 'string',
        description: '攻撃対象のエンティティ名（例: pig, cow, zombie）。省略時は敵対的Mobのみ',
        default: '',
      },
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

  async runImpl(entityName: string = '', maxAttacks: number = 10, maxDistance: number = 4.5) {
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

      const targetEntityName = entityName.toLowerCase().trim();
      let attackCount = 0;
      let lastTargetName = '';

      for (let i = 0; i < maxAttacks; i++) {
        // 最も近い対象を探す
        const target = this.bot.nearestEntity((entity) => {
          if (!entity || !entity.position) return false;

          const distance = entity.position.distanceTo(this.bot.entity.position);
          if (distance > maxDistance) return false;

          const name = entity.name?.toLowerCase() || '';

          // エンティティ名が指定されている場合はそれにマッチするものを探す
          if (targetEntityName) {
            return name.includes(targetEntityName);
          }

          // 指定がない場合は敵対的なMobのみ
          return hostileMobs.some((mob) => name.includes(mob));
        });

        if (!target) {
          if (attackCount === 0) {
            const targetDesc = targetEntityName || '敵対的Mob';
            return {
              success: false,
              result: `${maxDistance}ブロック以内に攻撃可能な${targetDesc}が見つかりません`,
            };
          }
          // 対象がいなくなったら終了
          break;
        }

        lastTargetName = target.name || 'unknown';
        const distance = target.position.distanceTo(this.bot.entity.position);

        // 距離が遠すぎる場合
        if (distance > 4.5) {
          return {
            success: true,
            result: `${lastTargetName}を${attackCount}回攻撃しましたが、対象が遠ざかりました（距離: ${distance.toFixed(1)}m）`,
          };
        }

        // 対象を見る
        await this.bot.lookAt(target.position.offset(0, target.height * 0.8, 0));

        // 攻撃
        await this.bot.attack(target);
        attackCount++;

        // 次の攻撃まで少し待つ（攻撃クールダウン）
        await new Promise((resolve) => setTimeout(resolve, 600));

        // 対象が死んだかチェック
        if (!target.isValid) {
          break;
        }
      }

      if (attackCount >= maxAttacks) {
        return {
          success: true,
          result: `${lastTargetName}を${attackCount}回攻撃しました（最大回数到達）`,
        };
      }

      return {
        success: true,
        result: `${lastTargetName}を${attackCount}回攻撃して倒しました`,
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

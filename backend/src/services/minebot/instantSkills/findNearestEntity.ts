import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 最も近いエンティティを検索
 */
class FindNearestEntity extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'find-nearest-entity';
    this.description = '指定したタイプの最も近いエンティティを検索します。';
    this.params = [
      {
        name: 'entityType',
        type: 'string',
        description:
          'エンティティタイプ（例: player, zombie, cow）。nullの場合は全エンティティから検索',
        default: null,
      },
      {
        name: 'maxDistance',
        type: 'number',
        description: '検索範囲（デフォルト: 64ブロック）',
        default: 64,
      },
    ];
  }

  async runImpl(entityType: string | null = null, maxDistance: number = 64) {
    try {
      const entity = this.bot.nearestEntity((e) => {
        if (e.position.distanceTo(this.bot.entity.position) > maxDistance) {
          return false;
        }
        if (entityType) {
          return e.name?.toLowerCase() === entityType.toLowerCase();
        }
        // 自分自身は除外
        return e !== this.bot.entity;
      });

      if (!entity) {
        const typeStr = entityType ? `${entityType}タイプの` : '';
        return {
          success: true,
          result: `${maxDistance}ブロック以内に${typeStr}エンティティは見つかりませんでした`,
        };
      }

      const distance =
        Math.floor(entity.position.distanceTo(this.bot.entity.position) * 10) /
        10;
      const pos = entity.position;

      return {
        success: true,
        result: `${entity.name || entity.type}を発見: 座標(${Math.floor(
          pos.x
        )}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}), 距離${distance}m`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `検索エラー: ${error.message}`,
      };
    }
  }
}

export default FindNearestEntity;

import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 周囲のエンティティをリスト表示
 */
class ListNearbyEntities extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'list-nearby-entities';
    this.description = '周囲のエンティティをリスト表示します。';
    this.params = [
      {
        name: 'maxDistance',
        type: 'number',
        description: '検索範囲（デフォルト: 32ブロック）',
        default: 32,
      },
      {
        name: 'maxCount',
        type: 'number',
        description: '最大表示数（デフォルト: 10個）',
        default: 10,
      },
    ];
  }

  async runImpl(maxDistance: number = 32, maxCount: number = 10) {
    try {
      const entities = Object.values(this.bot.entities)
        .filter((e) => {
          // 自分自身は除外
          if (e === this.bot.entity) return false;
          const distance = e.position.distanceTo(this.bot.entity.position);
          return distance <= maxDistance;
        })
        .map((e) => ({
          name: e.name || e.type,
          type: e.type,
          distance:
            Math.floor(e.position.distanceTo(this.bot.entity.position) * 10) /
            10,
          position: e.position,
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, maxCount);

      if (entities.length === 0) {
        return {
          success: true,
          result: `${maxDistance}ブロック以内にエンティティはいません`,
        };
      }

      const entityList = entities
        .map((e) => `${e.name}(${e.type}) 距離${e.distance}m`)
        .join(', ');

      return {
        success: true,
        result: `周囲のエンティティ(${entities.length}個): ${entityList}`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `取得エラー: ${error.message}`,
      };
    }
  }
}

export default ListNearbyEntities;

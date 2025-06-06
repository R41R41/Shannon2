import { CustomBot, InstantSkill } from '../types.js';
import fs from 'fs';
import { Vec3 } from 'vec3';
import path from 'path';

class GetEntitiesInfo extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'get-entities-info';
    this.description =
      '自分を含めた周囲のエンティティの情報を取得します。距離やエンティティの種類を指定することもできます。';
    this.priority = 100;
    this.canUseByCommand = false;
    this.params = [
      {
        name: 'distance',
        description: '取得する距離。デフォルトは32ブロック。',
        type: 'number',
        required: false,
        default: 32,
      },
      {
        name: 'entityType',
        description: '取得するエンティティの種類。デフォルトは全て。',
        type: 'string',
        required: false,
        default: null,
      },
    ];
  }

  async runImpl(distance: number = 32, entityType: string | null = null) {
    try {
      const entitiesInfo: {
        id: string;
        name: string;
        type: string;
        position: Vec3;
        distance: number;
      }[] = [];
      const filePath = path.join(
        process.cwd(),
        'saves/minecraft/entities_data.json'
      );

      const sortedEntities = Object.values(this.bot.entities)
        .filter((entity) => {
          const entityDistance = this.bot.entity.position.distanceTo(
            entity.position
          );
          // 距離でフィルタリング
          if (entityDistance > distance) {
            return false;
          }
          // エンティティタイプでフィルタリング（指定されている場合）
          if (
            entityType &&
            entity.name !== entityType &&
            entity.type !== entityType
          ) {
            return false;
          }
          return true;
        })
        .map((entity) => ({
          entity,
          distance: this.bot.entity.position.distanceTo(entity.position),
        }))
        .sort((a, b) => a.distance - b.distance)
        .map((item) => item.entity);

      sortedEntities.forEach((entity) => {
        const entityDistance = this.bot.entity.position.distanceTo(
          entity.position
        );
        entitiesInfo.push({
          id: entity.id.toString(),
          name: entity.username || entity.name || '',
          type: entity.type || '',
          position: entity.position,
          distance: Math.round(entityDistance * 100) / 100, // 小数点2桁まで表示
        });
      });

      // 結果が0件の場合のメッセージ
      if (entitiesInfo.length === 0) {
        return {
          success: true,
          result: entityType
            ? `指定された範囲(${distance}ブロック)内に「${entityType}」タイプのエンティティは見つかりませんでした。`
            : `指定された範囲(${distance}ブロック)内にエンティティは見つかりませんでした。`,
        };
      }

      // JSON形式でファイルに保存
      fs.writeFileSync(filePath, JSON.stringify(entitiesInfo, null, 2));

      return {
        success: true,
        result: `周囲のエンティティ：${JSON.stringify(entitiesInfo)}`,
      };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default GetEntitiesInfo;

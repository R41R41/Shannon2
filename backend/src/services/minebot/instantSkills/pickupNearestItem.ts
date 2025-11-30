import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 最も近いアイテムを拾う
 */
class PickupNearestItem extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'pickup-nearest-item';
    this.description = '最も近い地面のアイテムを拾います。';
    this.params = [
      {
        name: 'itemName',
        type: 'string',
        description: '拾いたいアイテム名（nullの場合は最も近いアイテム）',
        default: null,
      },
      {
        name: 'maxDistance',
        type: 'number',
        description: '検索範囲（デフォルト: 16ブロック）',
        default: 16,
      },
    ];
  }

  async runImpl(itemName: string | null = null, maxDistance: number = 16) {
    try {
      // 地面のアイテムエンティティを探す
      const itemEntity = this.bot.nearestEntity((entity) => {
        // アイテムエンティティかチェック
        if (entity.name !== 'item') return false;

        // 距離チェック
        const distance = entity.position.distanceTo(this.bot.entity.position);
        if (distance > maxDistance) return false;

        // 特定アイテムを指定している場合
        if (itemName) {
          // メタデータからアイテム情報を取得
          const metadata = entity.metadata as any;
          if (metadata && metadata[8]) {
            const itemData = metadata[8];
            // アイテム名が一致するかチェック
            return (
              itemData.itemId && itemData.itemId.toString().includes(itemName)
            );
          }
          return false;
        }

        return true;
      });

      if (!itemEntity) {
        const itemStr = itemName ? `${itemName}` : 'アイテム';
        return {
          success: false,
          result: `${maxDistance}ブロック以内に${itemStr}が見つかりません`,
        };
      }

      const distance = itemEntity.position.distanceTo(this.bot.entity.position);

      // アイテムに近づく
      if (distance > 1.5) {
        const pathfinder = require('mineflayer-pathfinder');
        const { goals } = pathfinder;
        const goal = new goals.GoalNear(
          itemEntity.position.x,
          itemEntity.position.y,
          itemEntity.position.z,
          1
        );

        // タイムアウト付きで移動
        const timeout = 10000;
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('移動タイムアウト')), timeout);
        });

        try {
          await Promise.race([this.bot.pathfinder.goto(goal), timeoutPromise]);
        } catch (error: any) {
          if (error.message.includes('timeout')) {
            return {
              success: false,
              result: 'アイテムに近づけませんでした（タイムアウト）',
            };
          }
          throw error;
        }
      }

      // アイテムが自動的に拾われるまで少し待つ
      await new Promise((resolve) => setTimeout(resolve, 500));

      return {
        success: true,
        result: `アイテムを拾いました（距離: ${distance.toFixed(1)}m）`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `アイテム拾得エラー: ${error.message}`,
      };
    }
  }
}

export default PickupNearestItem;

import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 指定座標のコンテナを開く
 */
class OpenContainer extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'open-container';
    this.description = '指定座標のチェストなどのコンテナを開きます。';
    this.params = [
      {
        name: 'x',
        type: 'number',
        description: 'X座標',
        required: true,
      },
      {
        name: 'y',
        type: 'number',
        description: 'Y座標',
        required: true,
      },
      {
        name: 'z',
        type: 'number',
        description: 'Z座標',
        required: true,
      },
    ];
  }

  async runImpl(x: number, y: number, z: number) {
    try {
      const pos = new Vec3(x, y, z);
      const block = this.bot.blockAt(pos);

      if (!block) {
        return {
          success: false,
          result: `座標(${x}, ${y}, ${z})にブロックが見つかりません`,
        };
      }

      // コンテナかチェック
      const containerTypes = [
        'chest',
        'trapped_chest',
        'ender_chest',
        'shulker_box',
        'barrel',
        'furnace',
        'blast_furnace',
        'smoker',
        'dispenser',
        'dropper',
        'hopper',
      ];

      const isContainer = containerTypes.some((type) =>
        block.name.includes(type)
      );

      if (!isContainer) {
        return {
          success: false,
          result: `${block.name}はコンテナではありません`,
        };
      }

      // 距離チェック
      const distance = this.bot.entity.position.distanceTo(pos);
      if (distance > 4.5) {
        return {
          success: false,
          result: `コンテナが遠すぎます（距離: ${distance.toFixed(
            1
          )}m、4.5m以内に近づいてください）`,
        };
      }

      // コンテナを開く
      const container = await this.bot.openContainer(block);

      if (!container) {
        return {
          success: false,
          result: `${block.name}を開けませんでした`,
        };
      }

      // スロット数を取得
      const slotCount = container.slots ? container.slots.length : 0;

      // 自動で閉じる（他のスキルで操作する前提）
      await new Promise((resolve) => setTimeout(resolve, 100));
      container.close();

      return {
        success: true,
        result: `${block.name}を開きました（スロット数: ${slotCount}）`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `コンテナオープンエラー: ${error.message}`,
      };
    }
  }
}

export default OpenContainer;

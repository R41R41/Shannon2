import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 指定座標のブロックにアイテムを使用（右クリック）
 */
class UseItemOnBlock extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'use-item-on-block';
    this.description =
      '手に持っているアイテムを指定ブロックに対して使用します（右クリック）。';
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
      // パラメータチェック
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return {
          success: false,
          result: '座標は有効な数値である必要があります',
        };
      }

      const heldItem = this.bot.heldItem;
      if (!heldItem) {
        return {
          success: false,
          result: '手に何も持っていません',
        };
      }

      const pos = new Vec3(x, y, z);
      const block = this.bot.blockAt(pos);

      if (!block) {
        return {
          success: false,
          result: `座標(${x}, ${y}, ${z})にブロックが見つかりません`,
        };
      }

      // 距離チェック
      const distance = this.bot.entity.position.distanceTo(pos);
      if (distance > 5) {
        return {
          success: false,
          result: `ブロックが遠すぎます（距離: ${distance.toFixed(
            1
          )}m、5m以内に近づいてください）`,
        };
      }

      // ブロックの中心を向く
      await this.bot.lookAt(pos.offset(0.5, 0.5, 0.5));

      // ブロックにアイテムを使用
      await this.bot.activateBlock(block);

      return {
        success: true,
        result: `${heldItem.name}を${block.name}に使用しました`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `使用エラー: ${error.message}`,
      };
    }
  }
}

export default UseItemOnBlock;

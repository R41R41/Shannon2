import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 指定座標のブロック情報を取得
 */
class GetBlockAt extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'get-block-at';
    this.description = '指定座標のブロック情報を取得します。';
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

      const info = {
        name: block.name,
        displayName: block.displayName,
        position: `(${x}, ${y}, ${z})`,
        diggable: block.diggable,
        hardness: block.hardness,
        material: block.material,
      };

      return {
        success: true,
        result: `ブロック情報: ${block.displayName}(${block.name}), 硬度${
          block.hardness
        }, 掘削可能: ${block.diggable ? 'はい' : 'いいえ'}`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `取得エラー: ${error.message}`,
      };
    }
  }
}

export default GetBlockAt;

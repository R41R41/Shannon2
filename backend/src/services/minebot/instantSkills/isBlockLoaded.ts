import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 指定座標がロード済みかチェック
 */
class IsBlockLoaded extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'is-block-loaded';
    this.description = '指定座標のチャンクがロード済みかチェックします。';
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

      const chunkX = Math.floor(x / 16);
      const chunkZ = Math.floor(z / 16);

      if (block === null) {
        return {
          success: true,
          result: `座標(${x}, ${y}, ${z})のチャンク(${chunkX}, ${chunkZ})は未ロードです`,
        };
      }

      return {
        success: true,
        result: `座標(${x}, ${y}, ${z})のチャンク(${chunkX}, ${chunkZ})はロード済みです（ブロック: ${block.name}）`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `チェックエラー: ${error.message}`,
      };
    }
  }
}

export default IsBlockLoaded;

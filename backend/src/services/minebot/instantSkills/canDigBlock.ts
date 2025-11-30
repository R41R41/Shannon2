import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: ブロックが掘削可能かチェック
 */
class CanDigBlock extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'can-dig-block';
    this.description = '指定座標のブロックが掘削可能かチェックします。';
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

      if (!block.diggable) {
        return {
          success: true,
          result: `${block.name}は掘削できません（岩盤など）`,
        };
      }

      // 最適なツールを取得
      const bestTool = this.bot.pathfinder.bestHarvestTool(block);
      const toolName = bestTool ? bestTool.name : 'なし';

      return {
        success: true,
        result: `${block.name}は掘削可能。最適ツール: ${toolName}`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `チェックエラー: ${error.message}`,
      };
    }
  }
}

export default CanDigBlock;

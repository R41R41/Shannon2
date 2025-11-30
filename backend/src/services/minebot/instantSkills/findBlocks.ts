import minecraftData from 'minecraft-data';
import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 周囲のブロックを検索
 */
class FindBlocks extends InstantSkill {
  private mcData: any;

  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'find-blocks';
    this.description =
      '指定したブロックを周囲から検索して座標リストを返します。';
    this.mcData = minecraftData(this.bot.version);
    this.params = [
      {
        name: 'blockName',
        type: 'string',
        description: '検索するブロック名（例: stone, diamond_ore, oak_log）',
        required: true,
      },
      {
        name: 'maxDistance',
        type: 'number',
        description: '検索範囲（デフォルト: 64ブロック）',
        default: 64,
      },
      {
        name: 'count',
        type: 'number',
        description: '検索する最大数（デフォルト: 10個）',
        default: 10,
      },
    ];
  }

  async runImpl(
    blockName: string,
    maxDistance: number = 64,
    count: number = 10
  ) {
    try {
      const blockType = this.mcData.blocksByName[blockName];
      if (!blockType) {
        return {
          success: false,
          result: `ブロック${blockName}が見つかりません`,
        };
      }

      const blocks = this.bot.findBlocks({
        matching: blockType.id,
        maxDistance: maxDistance,
        count: count,
      });

      if (blocks.length === 0) {
        return {
          success: true,
          result: `${maxDistance}ブロック以内に${blockName}は見つかりませんでした`,
        };
      }

      // 距離順にソート
      const sortedBlocks = blocks
        .map((pos) => ({
          x: pos.x,
          y: pos.y,
          z: pos.z,
          distance:
            Math.floor(this.bot.entity.position.distanceTo(pos) * 10) / 10,
        }))
        .sort((a, b) => a.distance - b.distance);

      const blockList = sortedBlocks
        .slice(0, 5) // 最初の5個だけ表示
        .map((b) => `(${b.x}, ${b.y}, ${b.z}) 距離${b.distance}m`)
        .join(', ');

      return {
        success: true,
        result: `${blockName}を${blocks.length}個発見: ${blockList}${
          blocks.length > 5 ? '...' : ''
        }`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `検索エラー: ${error.message}`,
      };
    }
  }
}

export default FindBlocks;

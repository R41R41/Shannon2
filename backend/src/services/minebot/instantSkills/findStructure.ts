import minecraftData from 'minecraft-data';
import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 特定の構造物を探す
 */
class FindStructure extends InstantSkill {
  private mcData: any;

  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'find-structure';
    this.description = '指定した構造物（要塞、村、ネザー要塞など）を探します。';
    this.mcData = minecraftData(this.bot.version);
    this.params = [
      {
        name: 'structureType',
        type: 'string',
        description:
          '構造物の種類（fortress=ネザー要塞, village=村, stronghold=要塞など）',
        required: true,
      },
    ];
  }

  async runImpl(structureType: string) {
    try {
      // 構造物の種類を正規化
      const normalizedType = structureType.toLowerCase();

      // サポートされている構造物
      const supportedStructures = [
        'fortress', // ネザー要塞
        'village', // 村
        'stronghold', // エンドポータル要塞
        'monument', // 海底神殿
        'mansion', // 森の洋館
        'temple', // ジャングル/砂漠の寺院
        'mineshaft', // 廃坑
        'bastion', // 砦の遺跡（ネザー）
      ];

      if (!supportedStructures.includes(normalizedType)) {
        return {
          success: false,
          result: `サポートされていない構造物です。対応: ${supportedStructures.join(
            ', '
          )}`,
        };
      }

      // 構造物に特徴的なブロックを探す
      let searchBlocks: string[] = [];
      let searchDistance = 128;

      switch (normalizedType) {
        case 'fortress':
          searchBlocks = ['nether_bricks', 'nether_brick_fence'];
          searchDistance = 256;
          break;
        case 'bastion':
          searchBlocks = ['blackstone', 'polished_blackstone_bricks'];
          searchDistance = 256;
          break;
        case 'village':
          searchBlocks = ['oak_planks', 'cobblestone', 'hay_block'];
          searchDistance = 128;
          break;
        case 'stronghold':
          searchBlocks = ['stone_bricks', 'mossy_stone_bricks'];
          searchDistance = 64;
          break;
        default:
          return {
            success: false,
            result: `${structureType}の検索方法が未実装です`,
          };
      }

      // 特徴的なブロックを探す
      let foundBlocks = [];
      for (const blockName of searchBlocks) {
        const blockType = this.mcData.blocksByName[blockName];
        if (!blockType) continue;

        const blocks = this.bot.findBlocks({
          matching: blockType.id,
          maxDistance: searchDistance,
          count: 10,
        });

        if (blocks.length > 0) {
          foundBlocks.push(...blocks);
        }
      }

      if (foundBlocks.length === 0) {
        return {
          success: true,
          result: `${searchDistance}ブロック以内に${structureType}の痕跡が見つかりませんでした。移動してから再度探索してください`,
        };
      }

      // 最も近いブロックを選択
      foundBlocks.sort((a, b) => {
        const distA = a.distanceTo(this.bot.entity.position);
        const distB = b.distanceTo(this.bot.entity.position);
        return distA - distB;
      });

      const nearest = foundBlocks[0];
      const distance = Math.floor(nearest.distanceTo(this.bot.entity.position));

      return {
        success: true,
        result: `${structureType}の痕跡を発見: 座標(${nearest.x}, ${nearest.y}, ${nearest.z}), 距離${distance}m`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `構造物探索エラー: ${error.message}`,
      };
    }
  }
}

export default FindStructure;

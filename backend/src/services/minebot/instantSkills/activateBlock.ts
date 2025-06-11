import minecraftData from 'minecraft-data';
import pathfinder from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';
const { goals } = pathfinder;

class ActivateBlock extends InstantSkill {
  private mcData: any;
  constructor(bot: CustomBot) {
    super(bot);
    this.mcData = minecraftData(this.bot.version);
    this.skillName = 'activate-block';
    this.description =
      '指定したブロックを右クリック（activate）します。ケーキを食べる、レバーやボタンを押すなどの用途に使用します。';
    this.params = [
      {
        name: 'blockName',
        description: '対象ブロック名（例: cake, crafting_table など）',
        type: 'string',
        required: true,
      },
      {
        name: 'blockPosition',
        description: '対象ブロックの座標（Vec3, 省略時は最も近いもの）',
        type: 'Vec3',
        required: false,
        default: null,
      },
    ];
  }

  async runImpl(blockName: string, blockPosition: Vec3 | null = null) {
    try {
      let targetBlock;
      if (blockPosition) {
        targetBlock = this.bot.blockAt(blockPosition);
        if (!targetBlock || targetBlock.name !== blockName) {
          return {
            success: false,
            result: `指定座標に${blockName}はありません。`,
          };
        }
      } else {
        // 周囲で最も近いblockNameのブロックを探す
        const blockId = this.mcData.blocksByName[blockName]?.id;
        if (!blockId) {
          return {
            success: false,
            result: `ブロック名 ${blockName} が無効です。`,
          };
        }
        targetBlock = this.bot.findBlock({
          matching: blockId,
          maxDistance: 32,
        });
        if (!targetBlock) {
          return {
            success: false,
            result: `周囲に${blockName}が見つかりません。`,
          };
        }
      }
      // 近づく
      await this.bot.pathfinder.goto(
        new goals.GoalNear(
          targetBlock.position.x,
          targetBlock.position.y,
          targetBlock.position.z,
          1
        )
      );
      // activateBlock
      await this.bot.activateBlock(targetBlock);
      return { success: true, result: `${blockName}を右クリックしました。` };
    } catch (error: any) {
      return {
        success: false,
        result: `activateBlock中にエラー: ${error.message}`,
      };
    }
  }
}

export default ActivateBlock;

import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 指定座標にブロックを設置
 */
class PlaceBlockAt extends InstantSkill {
  private mcData: any;

  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'place-block-at';
    this.description = '指定座標にブロックを設置します。';
    this.mcData = minecraftData(this.bot.version);
    this.params = [
      {
        name: 'blockName',
        type: 'string',
        description: '設置するブロック名',
        required: true,
      },
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

  async runImpl(blockName: string, x: number, y: number, z: number) {
    try {
      // パラメータチェック
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return {
          success: false,
          result: '座標は有効な数値である必要があります',
        };
      }

      const blockType = this.mcData.blocksByName[blockName];
      if (!blockType) {
        return {
          success: false,
          result: `ブロック${blockName}が見つかりません`,
        };
      }

      const item = this.bot.inventory
        .items()
        .find((item) => item.name === blockName);

      if (!item) {
        return {
          success: false,
          result: `インベントリに${blockName}がありません`,
        };
      }

      const targetPos = new Vec3(x, y, z);

      // 距離チェック
      const distance = this.bot.entity.position.distanceTo(targetPos);
      if (distance > 5) {
        return {
          success: false,
          result: `設置場所が遠すぎます（距離: ${distance.toFixed(
            1
          )}m、5m以内に近づいてください）`,
        };
      }

      // 設置場所がすでにブロックで埋まっているかチェック
      const existingBlock = this.bot.blockAt(targetPos);
      if (existingBlock && existingBlock.name !== 'air') {
        return {
          success: false,
          result: `座標(${x}, ${y}, ${z})にはすでに${existingBlock.name}があります`,
        };
      }

      // 参照ブロックを探す（設置する場所の隣接ブロック）
      const referenceBlock = this.bot.blockAt(targetPos.offset(0, -1, 0));

      if (!referenceBlock || referenceBlock.name === 'air') {
        return {
          success: false,
          result:
            '設置場所の下に参照ブロックがありません（空中には設置できません）',
        };
      }

      await this.bot.equip(item, 'hand');
      await this.bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));

      return {
        success: true,
        result: `${blockName}を(${x}, ${y}, ${z})に設置しました`,
      };
    } catch (error: any) {
      // エラーメッセージを詳細化
      let errorDetail = error.message;
      if (error.message.includes('far away')) {
        errorDetail = '設置場所が遠すぎます';
      } else if (error.message.includes('cannot place')) {
        errorDetail = 'ブロックを設置できません（空中、障害物など）';
      } else if (error.message.includes('equipped')) {
        errorDetail = 'アイテムを装備できませんでした';
      }

      return {
        success: false,
        result: `設置エラー: ${errorDetail}`,
      };
    }
  }
}

export default PlaceBlockAt;

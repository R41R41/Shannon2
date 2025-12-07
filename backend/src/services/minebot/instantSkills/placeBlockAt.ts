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
        description: '設置するブロック名（例: crafting_table, stone, cobblestone）※必須',
        required: true,
      },
      {
        name: 'x',
        type: 'number',
        description: 'X座標（整数）',
        required: true,
      },
      {
        name: 'y',
        type: 'number',
        description: 'Y座標（整数）',
        required: true,
      },
      {
        name: 'z',
        type: 'number',
        description: 'Z座標（整数）',
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

      // ボット自身がいる位置に設置しようとしていないかチェック
      // ボットは2ブロックの高さを持つ（足元と頭）
      const botPos = this.bot.entity.position;
      const botBlockX = Math.floor(botPos.x);
      const botBlockY = Math.floor(botPos.y);
      const botBlockZ = Math.floor(botPos.z);

      if (
        x === botBlockX &&
        z === botBlockZ &&
        (y === botBlockY || y === botBlockY + 1)
      ) {
        return {
          success: false,
          result: `座標(${x}, ${y}, ${z})はボット自身がいる位置です。別の場所に設置してください`,
        };
      }

      // 参照ブロックを探す（設置する場所の隣接ブロック）
      // 下→側面（東西南北）→上の順で探す
      const offsets: [number, number, number, number, number, number][] = [
        [0, -1, 0, 0, 1, 0],   // 下のブロック → 上向きに設置
        [1, 0, 0, -1, 0, 0],   // 東のブロック → 西向きに設置
        [-1, 0, 0, 1, 0, 0],   // 西のブロック → 東向きに設置
        [0, 0, 1, 0, 0, -1],   // 南のブロック → 北向きに設置
        [0, 0, -1, 0, 0, 1],   // 北のブロック → 南向きに設置
        [0, 1, 0, 0, -1, 0],   // 上のブロック → 下向きに設置
      ];

      let referenceBlock = null;
      let faceVector = new Vec3(0, 1, 0);

      for (const [ox, oy, oz, fx, fy, fz] of offsets) {
        const candidate = this.bot.blockAt(targetPos.offset(ox, oy, oz));
        if (candidate && candidate.name !== 'air') {
          referenceBlock = candidate;
          faceVector = new Vec3(fx, fy, fz);
          break;
        }
      }

      if (!referenceBlock) {
        return {
          success: false,
          result:
            '設置場所の周囲に参照ブロックがありません（空中には設置できません）',
        };
      }

      await this.bot.equip(item, 'hand');
      await this.bot.placeBlock(referenceBlock, faceVector);

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

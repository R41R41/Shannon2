import { CustomBot, InstantSkill } from '../types.js';
import fs from 'fs';
import path from 'path';
import pathfinder from 'mineflayer-pathfinder';
const { goals } = pathfinder;
import { Vec3 } from 'vec3';

class GetItemsinChestData extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'get-items-in-chest-data';
    this.description = 'チェストのデータを取得します';
    this.bot = bot;
    this.params = [
      {
        name: 'chestPosition',
        type: 'Vec3',
        description: 'チェストの座標',
        required: true,
      },
    ];
    this.canUseByCommand = false;
  }

  async run(chestPosition: Vec3) {
    try {
      // ブロック確認
      const block = this.bot.blockAt(chestPosition);
      if (!block || !block.name.includes('chest')) {
        return {
          success: false,
          result: `座標 (${chestPosition.x}, ${chestPosition.y}, ${chestPosition.z}) にチェストがありません。`,
        };
      }

      // チェストの近くに移動
      console.log(block);
      await this.bot.utils.goalBlock.goToNear(chestPosition, 2);
      // 少し待機
      await new Promise((resolve) => setTimeout(resolve, 500));
      // チェストを開く
      const chest = await this.bot.openChest(block);
      console.log(chest);
      // チェストの中身を取得
      // チェストのスロット範囲のみ抽出
      const chestSlotCount = chest.inventoryStart; // inventoryStartがチェストスロット数
      const items = chest.slots
        .slice(0, chestSlotCount)
        .filter((item) => item !== null)
        .map((item) => ({
          slot: item.slot,
          name: item.name,
          count: item.count,
          displayName: item.displayName,
        }));

      // JSONファイルに保存
      const filePath = path.join(
        process.cwd(),
        'saves',
        'minecraft',
        'chest_data.json'
      );
      const chestData = {
        position: {
          x: chestPosition.x,
          y: chestPosition.y,
          z: chestPosition.z,
        },
        items: items,
      };

      fs.writeFileSync(filePath, JSON.stringify(chestData, null, 2));

      // チェストを閉じる
      await chest.close();

      return {
        success: true,
        result: `チェストの中身：${JSON.stringify(chestData)}`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `チェストの処理中にエラーが発生しました: ${error.message} in ${error.stack}`,
      };
    }
  }
}

export default GetItemsinChestData;

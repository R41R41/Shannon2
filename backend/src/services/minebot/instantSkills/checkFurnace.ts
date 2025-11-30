import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: かまどの精錬状態を確認
 */
class CheckFurnace extends InstantSkill {
  private mcData: any;

  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'check-furnace';
    this.description = 'かまどの精錬状態（完了したか）を確認します。';
    this.mcData = minecraftData(this.bot.version);
    this.params = [
      {
        name: 'x',
        type: 'number',
        description: 'かまどのX座標',
        required: true,
      },
      {
        name: 'y',
        type: 'number',
        description: 'かまどのY座標',
        required: true,
      },
      {
        name: 'z',
        type: 'number',
        description: 'かまどのZ座標',
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

      // 距離チェック
      const distance = this.bot.entity.position.distanceTo(pos);
      if (distance > 4.5) {
        return {
          success: false,
          result: `かまどが遠すぎます（距離: ${distance.toFixed(1)}m）`,
        };
      }

      // かまどを開く
      const furnace = await this.bot.openFurnace(block);
      if (!furnace) {
        return {
          success: false,
          result: 'かまどを開けませんでした',
        };
      }

      try {
        // 出力スロットを確認
        const outputItem = furnace.outputItem();
        const inputItem = furnace.inputItem();
        const fuelItem = furnace.fuelItem();

        furnace.close();

        if (outputItem) {
          return {
            success: true,
            result: `精錬完了: ${outputItem.name} x${outputItem.count}が取り出せます`,
          };
        } else if (inputItem) {
          return {
            success: true,
            result: `精錬中: ${inputItem.name} x${
              inputItem.count
            }を精錬中（燃料: ${fuelItem ? fuelItem.name : 'なし'}）`,
          };
        } else {
          return {
            success: true,
            result: 'かまどは空です',
          };
        }
      } catch (error: any) {
        furnace.close();
        throw error;
      }
    } catch (error: any) {
      return {
        success: false,
        result: `確認エラー: ${error.message}`,
      };
    }
  }
}

export default CheckFurnace;

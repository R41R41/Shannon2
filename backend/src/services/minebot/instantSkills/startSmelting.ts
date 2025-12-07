import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: かまどで精錬を開始
 */
class StartSmelting extends InstantSkill {
  private mcData: any;

  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'start-smelting';
    this.description = 'かまどに材料と燃料を入れて精錬を開始します。';
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
      {
        name: 'inputItem',
        type: 'string',
        description: '精錬する材料（例: raw_iron, raw_gold）',
        required: true,
      },
      {
        name: 'fuelItem',
        type: 'string',
        description: '燃料（例: coal, planks, stick）',
        required: true,
      },
      {
        name: 'count',
        type: 'number',
        description: '精錬する個数',
        default: 1,
      },
    ];
  }

  async runImpl(
    x: number,
    y: number,
    z: number,
    inputItem: string,
    fuelItem: string,
    count: number = 1
  ) {
    try {
      const pos = new Vec3(x, y, z);
      const block = this.bot.blockAt(pos);

      if (!block) {
        return {
          success: false,
          result: `座標(${x}, ${y}, ${z})にブロックが見つかりません`,
        };
      }

      // かまどかチェック
      if (
        !block.name.includes('furnace') &&
        !block.name.includes('smoker') &&
        !block.name.includes('blast_furnace')
      ) {
        return {
          success: false,
          result: `${block.name}はかまどではありません`,
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

      // 材料と燃料を持っているかチェック
      const inputItems = this.bot.inventory
        .items()
        .filter((item) => item.name === inputItem);
      const fuelItems = this.bot.inventory
        .items()
        .filter((item) => item.name === fuelItem);

      if (inputItems.length === 0) {
        return {
          success: false,
          result: `${inputItem}を持っていません`,
        };
      }

      if (fuelItems.length === 0) {
        return {
          success: false,
          result: `燃料${fuelItem}を持っていません`,
        };
      }

      const inputCount = inputItems.reduce((sum, item) => sum + item.count, 0);
      if (inputCount < count) {
        return {
          success: false,
          result: `${inputItem}が不足しています（必要: ${count}個、所持: ${inputCount}個）`,
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
        // スロットの状態を確認
        const currentInput = furnace.inputItem();
        const currentFuel = furnace.fuelItem();
        const currentOutput = furnace.outputItem();

        // 材料スロットに別のアイテムが入っているかチェック
        if (currentInput && currentInput.name !== inputItem) {
          furnace.close();
          return {
            success: false,
            result: `材料スロットに別のアイテムがあります: ${currentInput.name} x${currentInput.count}。先に取り出してください（withdraw-from-furnace slot="input"）`,
          };
        }

        // 燃料スロットに別のアイテムが入っているかチェック
        if (currentFuel && currentFuel.name !== fuelItem) {
          furnace.close();
          return {
            success: false,
            result: `燃料スロットに別のアイテムがあります: ${currentFuel.name} x${currentFuel.count}。先に取り出してください（withdraw-from-furnace slot="fuel"）`,
          };
        }

        // 出力スロットにアイテムがあれば警告
        if (currentOutput) {
          furnace.close();
          return {
            success: false,
            result: `完成品スロットにアイテムがあります: ${currentOutput.name} x${currentOutput.count}。先に取り出してください（withdraw-from-furnace slot="output"）`,
          };
        }

        // 材料スロットの空き容量をチェック
        if (currentInput) {
          const maxStack = 64; // ほとんどのアイテムのスタック上限
          const availableSpace = maxStack - currentInput.count;
          if (count > availableSpace) {
            furnace.close();
            return {
              success: false,
              result: `材料スロットに空きが足りません。現在: ${currentInput.name} x${currentInput.count}、追加可能: ${availableSpace}個`,
            };
          }
        }

        // 材料を入れる（上のスロット）
        await furnace.putInput(inputItems[0].type, null, count);

        // 燃料を入れる（下のスロット）
        await furnace.putFuel(fuelItems[0].type, null, 1);

        furnace.close();

        return {
          success: true,
          result: `${inputItem} x${count}の精錬を開始しました（燃料: ${fuelItem}）`,
        };
      } catch (error: any) {
        furnace.close();
        throw error;
      }
    } catch (error: any) {
      return {
        success: false,
        result: `精錬開始エラー: ${error.message}`,
      };
    }
  }
}

export default StartSmelting;

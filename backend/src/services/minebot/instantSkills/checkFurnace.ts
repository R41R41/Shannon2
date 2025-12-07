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
    this.description = 'かまどの精錬状態（完了したか）や各スロットの中身を確認します。';
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
        // 全スロットを確認
        const outputItem = furnace.outputItem();
        const inputItem = furnace.inputItem();
        const fuelItem = furnace.fuelItem();
        const fuel = furnace.fuel; // 残り燃焼時間
        const progress = furnace.progress; // 精錬進捗

        furnace.close();

        // 各スロットの状態を構築
        const slots: string[] = [];

        if (inputItem) {
          slots.push(`材料: ${inputItem.name} x${inputItem.count}`);
        } else {
          slots.push('材料: なし');
        }

        if (fuelItem) {
          slots.push(`燃料: ${fuelItem.name} x${fuelItem.count}`);
        } else {
          slots.push('燃料: なし');
        }

        if (outputItem) {
          slots.push(`完成品: ${outputItem.name} x${outputItem.count}（取り出し可能）`);
        } else {
          slots.push('完成品: なし');
        }

        // 精錬状態を判定
        let status = '';
        if (inputItem && fuel > 0) {
          const progressPercent = Math.round(progress * 100);
          status = `精錬中（進捗: ${progressPercent}%）`;
        } else if (outputItem && !inputItem) {
          status = '精錬完了';
        } else if (!inputItem && !fuelItem && !outputItem) {
          status = '空';
        } else if (inputItem && fuel === 0) {
          status = '燃料切れ';
        } else {
          status = '待機中';
        }

        return {
          success: true,
          result: `[${status}] ${slots.join(' | ')}`,
        };
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

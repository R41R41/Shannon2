import { CustomBot, InstantSkill } from '../types.js';
import pathfinder from 'mineflayer-pathfinder';
const { goals } = pathfinder;

class TradeWithVillager extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'trade-with-villager';
    this.description = '近くの村人と指定した取引スロットで交易します。';
    this.params = [
      {
        name: 'tradeIndex',
        description: '取引スロット番号（0始まり）',
        type: 'number',
        required: true,
      },
      {
        name: 'times',
        description: '何回取引するか（省略時は1回）',
        type: 'number',
        required: false,
        default: 1,
      },
      {
        name: 'villagerEntityId',
        description: '村人のエンティティID（省略時は最も近い村人）',
        type: 'number',
        required: false,
      },
    ];
  }

  async runImpl(tradeIndex: number, times: number = 1, villagerEntityId?: number) {
    try {
      // 村人を取得
      let villager: any;
      if (villagerEntityId) {
        villager = this.bot.entities[villagerEntityId];
      } else {
        // 最も近い村人を自動選択
        villager = Object.values(this.bot.entities).find(
          (e: any) => e.name === 'villager'
        );
      }
      if (!villager) {
        return { success: false, result: '近くに村人がいません。' };
      }

      // 村人に近づく
      console.log(`${villager.name}へ到達を試みています...`);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('移動タイムアウト')), 10000);
      });
      const goal = new goals.GoalNear(
        villager.position.x,
        villager.position.y,
        villager.position.z,
        1
      );
      const movePromise = this.bot.pathfinder.goto(goal);
      await Promise.race([movePromise, timeoutPromise]);

      // 取引UIを開く
      const window = (await this.bot.openVillager(villager)) as any;
      if (!window || !window.trades) {
        return { success: false, result: '取引UIを開けませんでした。' };
      }

      // 指定スロットで取引
      for (let i = 0; i < times; i++) {
        if (!window.trades[tradeIndex]) {
          return {
            success: false,
            result: `指定スロット${tradeIndex}の取引がありません。`,
          };
        }
        await window.trade(tradeIndex, 1);
        await this.bot.waitForTicks(10); // 少し待つ
      }

      window.close();
      return { success: true, result: `村人と${times}回取引しました。` };
    } catch (error: any) {
      return { success: false, result: `交易中にエラー: ${error.message}` };
    }
  }
}

export default TradeWithVillager;

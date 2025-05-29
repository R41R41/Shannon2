import { CustomBot, InstantSkill } from '../types.js';
import pathfinder from 'mineflayer-pathfinder';
const { goals } = pathfinder;

class SearchTradingVillager extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'search-trading-villager';
    this.description =
      '指定したアイテム（もらえる側）を取引できる村人を探し、必要なコストも返します。';
    this.params = [
      {
        name: 'outputItemName',
        description:
          'もらいたい取引アイテム名（例: emerald, bread, paper など）',
        type: 'string',
        required: true,
      },
    ];
  }

  async run(outputItemName: string) {
    try {
      const villagers = Object.values(this.bot.entities).filter(
        (e: any) => e.name === 'villager'
      );
      if (villagers.length === 0) {
        return { success: false, result: '近くに村人がいません。' };
      }
      for (const villager of villagers) {
        try {
          // 近づく
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

          // ウィンドウを開く
          const window = (await this.bot.openVillager(villager)) as any;
          if (window && Array.isArray(window.trades)) {
            for (let i = 0; i < window.trades.length; i++) {
              const trade = window.trades[i];
              if (
                trade.outputItem &&
                trade.outputItem.name.includes(outputItemName)
              ) {
                const costs = [];
                if (trade.inputItem1) {
                  costs.push({
                    name: trade.inputItem1.name,
                    count: trade.inputItem1.count,
                  });
                }
                if (trade.inputItem2) {
                  costs.push({
                    name: trade.inputItem2.name,
                    count: trade.inputItem2.count,
                  });
                }
                window.close && window.close();
                return {
                  success: true,
                  result: JSON.stringify({
                    villagerEntityId: villager.id,
                    tradeIndex: i,
                    costs,
                  }),
                };
              }
            }
          }
          window.close && window.close();
        } catch (e) {
          // 無視して次の村人へ
        }
      }
      return {
        success: false,
        result: '指定アイテムで取引できる村人が見つかりませんでした。',
      };
    } catch (error: any) {
      return { success: false, result: `村人検索中にエラー: ${error.message}` };
    }
  }
}

export default SearchTradingVillager;

import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 村人と取引する
 */
class TradeWithVillager extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'trade-with-villager';
    this.description = '最も近い村人と取引します。';
    this.params = [
      {
        name: 'tradeIndex',
        type: 'number',
        description: '取引のインデックス（0から始まる）',
        required: true,
      },
      {
        name: 'times',
        type: 'number',
        description: '取引回数（デフォルト: 1）',
        default: 1,
      },
    ];
  }

  async runImpl(tradeIndex: number, times: number = 1) {
    try {
      // パラメータチェック
      if (!Number.isInteger(tradeIndex) || tradeIndex < 0) {
        return {
          success: false,
          result: '取引インデックスは0以上の整数である必要があります',
        };
      }

      if (!Number.isInteger(times) || times < 1 || times > 64) {
        return {
          success: false,
          result: '取引回数は1〜64の整数である必要があります',
        };
      }

      // 最も近い村人を探す
      const villager = this.bot.nearestEntity((entity) => {
        if (!entity || !entity.name) return false;
        return entity.name.toLowerCase().includes('villager');
      });

      if (!villager) {
        return {
          success: false,
          result: '近くに村人が見つかりません',
        };
      }

      const distance = villager.position.distanceTo(this.bot.entity.position);

      if (distance > 4.5) {
        return {
          success: false,
          result: `村人が遠すぎます（距離: ${distance.toFixed(
            1
          )}m、4.5m以内に近づいてください）`,
        };
      }

      // 村人を右クリックして取引UIを開く
      await this.bot.activateEntity(villager);

      // 少し待つ（取引UIが開くまで）
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 取引情報を取得（mineflayer-tradeプラグインが必要）
      const tradeWindow = (this.bot as any).trade;

      if (!tradeWindow) {
        return {
          success: false,
          result:
            '取引ウィンドウを開けませんでした（mineflayer-tradeプラグインが必要です）',
        };
      }

      const trades = tradeWindow.trades;
      if (!trades || trades.length === 0) {
        tradeWindow.close();
        return {
          success: false,
          result: 'この村人は取引を提供していません',
        };
      }

      if (tradeIndex >= trades.length) {
        tradeWindow.close();
        return {
          success: false,
          result: `取引インデックス${tradeIndex}は範囲外です（0〜${
            trades.length - 1
          }が有効）`,
        };
      }

      const trade = trades[tradeIndex];

      // 必要なアイテムを持っているかチェック
      const hasInput1 = this.bot.inventory
        .items()
        .find((item) => item.type === trade.inputItem1.type);
      const hasInput2 = trade.hasItem2
        ? this.bot.inventory
            .items()
            .find((item) => item.type === trade.inputItem2.type)
        : true;

      if (!hasInput1) {
        tradeWindow.close();
        return {
          success: false,
          result: `取引に必要なアイテムを持っていません（${trade.inputItem1.name} x${trade.inputItem1.count}が必要）`,
        };
      }

      if (trade.hasItem2 && !hasInput2) {
        tradeWindow.close();
        return {
          success: false,
          result: `取引に必要なアイテムを持っていません（${trade.inputItem2.name} x${trade.inputItem2.count}が必要）`,
        };
      }

      // 取引を実行
      for (let i = 0; i < times; i++) {
        try {
          await tradeWindow.trade(tradeIndex, 1);
          await new Promise((resolve) => setTimeout(resolve, 200));
        } catch (error: any) {
          tradeWindow.close();
          if (i === 0) {
            return {
              success: false,
              result: `取引エラー: ${error.message}`,
            };
          } else {
            return {
              success: true,
              result: `${i}回取引しました（${times}回中）`,
            };
          }
        }
      }

      tradeWindow.close();

      return {
        success: true,
        result: `村人と${times}回取引しました（取引: ${trade.outputItem.name} x${trade.outputItem.count}を入手）`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `取引エラー: ${error.message}`,
      };
    }
  }
}

export default TradeWithVillager;

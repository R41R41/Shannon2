import pathfinder from 'mineflayer-pathfinder';
import { CustomBot, InstantSkill } from '../types.js';

const { goals } = pathfinder;

/**
 * 原子的スキル: 村人と取引する
 */
class TradeWithVillager extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'trade-with-villager';
    this.description = '指定された村人を探して条件に合う取引を行います。';
    this.params = [
      {
        name: 'inputItemName',
        description: '取引で渡すアイテム名',
        type: 'string',
        required: true,
      },
      {
        name: 'inputItemCount',
        description: '取引で渡すアイテムの個数（省略時はもらうアイテムの個数優先）',
        type: 'number',
        required: false,
      },
      {
        name: 'outputItemName',
        description: '取引でもらうアイテム名',
        type: 'string',
        required: true,
      },
      {
        name: 'outputItemCount',
        description: 'もらうアイテムの個数（省略時は渡すアイテムの個数優先）',
        type: 'number',
        required: false,
      },
      {
        name: 'profession',
        description: '村人の職業（例: farmer, weaponsmith, butcher, fletcher, armorer, mason, nitwit, librarian, cartographer, shepherd, toolsmith, cleric など）。villagerIdを指定する場合は省略可',
        type: 'string',
        required: false,
      },
      {
        name: 'villagerId',
        description: '村人のエンティティID（list-nearby-entitiesで取得可能）。指定すると職業よりも優先される',
        type: 'number',
        required: false,
      },
    ];
  }

  async runImpl(
    inputItemName: string,
    inputItemCount: number | undefined,
    outputItemName: string,
    outputItemCount: number | undefined,
    profession: string | undefined,
    villagerId: number | undefined
  ) {
    try {
      // バリデーション
      if (
        (inputItemCount === undefined || inputItemCount === null) &&
        (outputItemCount === undefined || outputItemCount === null)
      ) {
        return {
          success: false,
          result: '渡すアイテムの個数またはもらうアイテムの個数のいずれかを指定してください。',
        };
      }

      // professionもvillagerIdも指定されていない場合
      if (!profession && villagerId === undefined) {
        return {
          success: false,
          result: 'professionまたはvillagerIdのいずれかを指定してください。',
        };
      }

      const myPos = this.bot.entity.position;
      let villagers: any[] = [];

      // villagerIdが指定されている場合は直接その村人を使用
      if (villagerId !== undefined) {
        const villager = this.bot.entities[villagerId];
        if (!villager) {
          return {
            success: false,
            result: `ID:${villagerId}のエンティティが見つかりません。`,
          };
        }
        if (villager.name !== 'villager') {
          return {
            success: false,
            result: `ID:${villagerId}は村人ではありません（${villager.name}）。`,
          };
        }
        villagers = [villager];
      } else {
        // professionで検索
        const professionMap = [
          'none',
          'armorer',
          'butcher',
          'cartographer',
          'cleric',
          'farmer',
          'fisherman',
          'fletcher',
          'leatherworker',
          'librarian',
          'mason',
          'nitwit',
          'shepherd',
          'toolsmith',
          'weaponsmith',
        ];

        villagers = Object.values(this.bot.entities).filter((e: any) => {
          if (e.name !== 'villager') return false;
          if (myPos.distanceTo(e.position) > 64) return false;
          const professionId = e.metadata?.[18]?.villagerProfession ?? 0;
          const professionName = professionMap[professionId] || 'none';
          return professionName === profession;
        });

        if (villagers.length === 0) {
          return {
            success: false,
            result: `指定職業（${profession}）の村人が周囲64ブロック以内にいません。`,
          };
        }

        // 近い順にソート
        villagers.sort(
          (a: any, b: any) =>
            myPos.distanceTo(a.position) - myPos.distanceTo(b.position)
        );
      }

      for (const villager of villagers) {
        try {
          // 近づく
          const distance = myPos.distanceTo(villager.position);
          if (distance > 3) {
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('移動タイムアウト')), 10000)
            );
            const goal = new goals.GoalNear(
              villager.position.x,
              villager.position.y,
              villager.position.z,
              2
            );
            const movePromise = this.bot.pathfinder.goto(goal);
            await Promise.race([movePromise, timeoutPromise]);
          }

          // 取引UIを開く
          const window = (await this.bot.openVillager(villager)) as any;
          if (!window || !window.trades) {
            window?.close && window.close();
            continue;
          }

          // 2. 取引条件に合うスロットを探す
          for (let i = 0; i < window.trades.length; i++) {
            const trade = window.trades[i];
            if (
              trade.outputItem &&
              trade.outputItem.name.includes(outputItemName) &&
              trade.inputItem1 &&
              trade.inputItem1.name.includes(inputItemName)
            ) {
              // 取引レート取得
              const rateInput1 = trade.inputItem1.count;
              const rateInput2 = trade.inputItem2 ? trade.inputItem2.count : 0;
              const rateOutput = trade.outputItem.count;

              // インベントリ所持数
              const invCount1 = this.bot.inventory
                .items()
                .filter((item) => item.name === trade.inputItem1.name)
                .reduce((acc, item) => acc + item.count, 0);
              const invCount2 = trade.inputItem2
                ? this.bot.inventory
                  .items()
                  .filter((item) => item.name === trade.inputItem2.name)
                  .reduce((acc, item) => acc + item.count, 0)
                : 0;

              // 取引回数計算
              let maxByInput = Infinity;
              let maxByOutput = Infinity;

              if (inputItemCount !== undefined && inputItemCount !== null) {
                maxByInput = Math.floor(inputItemCount / rateInput1);
              } else {
                maxByInput = Math.floor(invCount1 / rateInput1);
              }
              if (outputItemCount !== undefined && outputItemCount !== null) {
                maxByOutput = Math.floor(outputItemCount / rateOutput);
              }

              // 取引回数は両方指定時は少ない方、どちらかのみ指定時はそちら
              let tradeTimes = Math.min(maxByInput, maxByOutput);
              if (inputItemCount !== undefined && outputItemCount === undefined)
                tradeTimes = maxByInput;
              if (outputItemCount !== undefined && inputItemCount === undefined)
                tradeTimes = maxByOutput;

              // インベントリ実際所持数で制限
              tradeTimes = Math.min(
                tradeTimes,
                Math.floor(invCount1 / rateInput1)
              );
              if (trade.inputItem2) {
                tradeTimes = Math.min(
                  tradeTimes,
                  Math.floor(invCount2 / rateInput2)
                );
              }

              if (tradeTimes <= 0) {
                window.close && window.close();
                return {
                  success: false,
                  result: `取引に必要なアイテムが足りません。必要: ${trade.inputItem1.name} x${rateInput1}`,
                };
              }

              // 取引実行
              for (let t = 0; t < tradeTimes; t++) {
                await window.trade(i, 1);
                await this.bot.waitForTicks(10);
              }

              window.close && window.close();
              return {
                success: true,
                result: `取引成功: ${trade.outputItem.name}を${tradeTimes * rateOutput}個入手しました（${trade.inputItem1.name} x${tradeTimes * rateInput1}を消費）`,
              };
            }
          }

          window.close && window.close();
        } catch (e: any) {
          // 次の村人へ
          console.error(`村人との取引エラー: ${e.message}`);
        }
      }

      return {
        success: false,
        result: `条件に合う取引が見つかりませんでした（${inputItemName} → ${outputItemName}）。`,
      };
    } catch (error: any) {
      return { success: false, result: `取引中にエラー: ${error.message}` };
    }
  }
}

export default TradeWithVillager;

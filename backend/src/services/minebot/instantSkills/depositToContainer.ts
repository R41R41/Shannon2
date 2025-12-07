import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: コンテナにアイテムを入れる
 */
class DepositToContainer extends InstantSkill {
  private mcData: any;

  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'deposit-to-container';
    this.description = 'コンテナにアイテムを入れます。';
    this.mcData = minecraftData(this.bot.version);
    this.params = [
      {
        name: 'x',
        type: 'number',
        description: 'コンテナのX座標',
        required: true,
      },
      {
        name: 'y',
        type: 'number',
        description: 'コンテナのY座標',
        required: true,
      },
      {
        name: 'z',
        type: 'number',
        description: 'コンテナのZ座標',
        required: true,
      },
      {
        name: 'itemName',
        type: 'string',
        description: '入れるアイテム名',
        required: true,
      },
      {
        name: 'count',
        type: 'number',
        description: '入れる個数（nullの場合は全部）',
        default: null,
      },
    ];
  }

  async runImpl(
    x: number,
    y: number,
    z: number,
    itemName: string,
    count: number | null = null
  ) {
    try {
      // パラメータチェック
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return {
          success: false,
          result: '座標は有効な数値である必要があります',
        };
      }

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
          result: `コンテナが遠すぎます（距離: ${distance.toFixed(
            1
          )}m、4.5m以内に近づいてください）`,
        };
      }

      // アイテムを持っているかチェック
      const items = this.bot.inventory
        .items()
        .filter((item) => item.name === itemName);
      if (items.length === 0) {
        return {
          success: false,
          result: `${itemName}をインベントリに持っていません`,
        };
      }

      const totalCount = items.reduce((sum, item) => sum + item.count, 0);
      const depositCount =
        count !== null ? Math.min(count, totalCount) : totalCount;

      // コンテナを開く
      const container = await this.bot.openContainer(block);
      if (!container) {
        return {
          success: false,
          result: `${block.name}を開けませんでした`,
        };
      }

      try {
        // アイテムを入れる
        let remaining = depositCount;
        for (const item of items) {
          if (remaining <= 0) break;
          const depositAmount = Math.min(item.count, remaining);
          await container.deposit(item.type, null, depositAmount);
          remaining -= depositAmount;
        }

        container.close();

        return {
          success: true,
          result: `${itemName}を${depositCount}個${block.name}に入れました`,
        };
      } catch (error: any) {
        container.close();
        throw error;
      }
    } catch (error: any) {
      // エラーメッセージを詳細化
      let errorDetail = error.message;
      if (error.message.includes('full')) {
        errorDetail = 'コンテナが満杯です';
      } else if (error.message.includes('deposit')) {
        errorDetail = 'アイテムを入れられませんでした';
      }

      return {
        success: false,
        result: `格納エラー: ${errorDetail}`,
      };
    }
  }
}

export default DepositToContainer;

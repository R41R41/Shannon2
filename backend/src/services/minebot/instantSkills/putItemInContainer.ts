import { CustomBot, InstantSkill } from '../types.js';
import { Vec3 } from 'vec3';

class PutItemInContainer extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'put-item-in-container';
    this.description = 'チェストやシュルカーボックスにアイテムを入れます。';
    this.bot = bot;
    this.params = [
      {
        name: 'containerPosition',
        type: 'Vec3',
        description: 'チェストやシュルカーボックスの座標',
        required: true,
      },
      {
        name: 'itemName',
        type: 'string',
        description: '入れるアイテムの名前',
        required: true,
      },
      {
        name: 'amount',
        type: 'number',
        description: '入れるアイテムの数',
        required: true,
      },
    ];
    this.canUseByCommand = false;
  }

  async runImpl(containerPosition: Vec3, itemName: string, amount: number) {
    try {
      // ブロック確認
      const block = this.bot.blockAt(containerPosition);
      if (
        !block ||
        !(block.name.includes('chest') || block.name.includes('shulker'))
      ) {
        return {
          success: false,
          result: `座標 (${containerPosition.x}, ${containerPosition.y}, ${containerPosition.z}) にチェストまたはシュルカーボックスがありません。`,
        };
      }

      // インベントリからアイテムを探す
      const items = this.bot.inventory.items();
      const targetItems = items.filter(
        (item) =>
          item.name.includes(itemName) ||
          (item.displayName &&
            item.displayName.toLowerCase().includes(itemName.toLowerCase()))
      );

      if (targetItems.length === 0) {
        return {
          success: false,
          result: `インベントリ内に "${itemName}" が見つかりませんでした。`,
        };
      }

      // コンテナを開く
      const container = await this.bot.openChest(block);

      // アイテム格納の実行
      let remainingAmount = amount;
      let totalDeposited = 0;

      for (const item of targetItems) {
        if (remainingAmount <= 0) break;

        const depositAmount = Math.min(remainingAmount, item.count);
        await container.deposit(item.type, item.metadata, depositAmount);

        remainingAmount -= depositAmount;
        totalDeposited += depositAmount;
      }

      // コンテナを閉じる
      await container.close();

      // コンテナの種類を判定
      const containerType = block.name.includes('shulker')
        ? 'シュルカーボックス'
        : 'チェスト';

      if (totalDeposited === 0) {
        return {
          success: false,
          result: `"${itemName}" を${containerType}に格納できませんでした。`,
        };
      } else if (totalDeposited < amount) {
        return {
          success: true,
          result: `"${itemName}" を ${totalDeposited}個${containerType}に格納しました（要求: ${amount}個）。`,
        };
      } else {
        return {
          success: true,
          result: `"${itemName}" を ${amount}個${containerType}に格納しました。`,
        };
      }
    } catch (error: any) {
      return {
        success: false,
        result: `コンテナにアイテムを格納中にエラーが発生しました: ${error.message}`,
      };
    }
  }
}

export default PutItemInContainer;

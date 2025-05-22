import { CustomBot, InstantSkill } from '../types.js';
import { Vec3 } from 'vec3';

class GetItemFromContainer extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'get-item-from-container';
    this.description = 'チェストやシュルカーボックスからアイテムを取得します';
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
        description: '取得するアイテムの名前',
        required: true,
      },
      {
        name: 'amount',
        type: 'number',
        description: '取得するアイテムの数',
        required: true,
      },
    ];
    this.canUseByCommand = false;
  }

  async run(chestPosition: Vec3, itemName: string, amount: number) {
    try {
      // ブロック確認
      const block = this.bot.blockAt(chestPosition);
      if (
        !block ||
        !(block.name.includes('chest') || block.name.includes('shulker'))
      ) {
        return {
          success: false,
          result: `座標 (${chestPosition.x}, ${chestPosition.y}, ${chestPosition.z}) にチェストまたはシュルカーボックスがありません。`,
        };
      }

      // コンテナを開く
      const container = await this.bot.openChest(block);
      const containerSlotCount = container.inventoryStart; // inventoryStartがコンテナスロット数
      const items = container.slots
        .slice(0, containerSlotCount)
        .filter((item) => item !== null);
      const targetItems = items.filter(
        (item) =>
          item.name.includes(itemName) ||
          (item.displayName &&
            item.displayName.toLowerCase().includes(itemName.toLowerCase()))
      );

      if (targetItems.length === 0) {
        await container.close();
        return {
          success: false,
          result: `コンテナ内に "${itemName}" が見つかりませんでした。`,
        };
      }

      // アイテム取得の実行
      let remainingAmount = amount;
      let totalWithdrawn = 0;

      for (const item of targetItems) {
        if (remainingAmount <= 0) break;

        const withdrawAmount = Math.min(remainingAmount, item.count);
        await container.withdraw(item.type, item.metadata, withdrawAmount);

        remainingAmount -= withdrawAmount;
        totalWithdrawn += withdrawAmount;
      }

      // コンテナを閉じる
      await container.close();

      const containerType = block.name.includes('shulker')
        ? 'シュルカーボックス'
        : 'チェスト';

      if (totalWithdrawn === 0) {
        return {
          success: false,
          result: `${containerType}から "${itemName}" を取得できませんでした。`,
        };
      } else if (totalWithdrawn < amount) {
        return {
          success: true,
          result: `${containerType}から "${itemName}" を ${totalWithdrawn}個取得しました（要求: ${amount}個）。`,
        };
      } else {
        return {
          success: true,
          result: `${containerType}から "${itemName}" を ${amount}個取得しました。`,
        };
      }
    } catch (error: any) {
      return {
        success: false,
        result: `コンテナからアイテムを取得中にエラーが発生しました: ${error.message}`,
      };
    }
  }
}

export default GetItemFromContainer;

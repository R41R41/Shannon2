import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';

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
        name: 'items',
        type: 'string',
        description:
          '取得するアイテムの名前と数の配列。ただし、countが省略されている場合はチェストにあるその名前の全てのアイテムを取得する。 形式：[{"name": "アイテム名", "count": 数},{"name": "アイテム名", "count": 数},...]',
        required: true,
      },
    ];
    this.canUseByCommand = false;
  }

  async runImpl(containerPosition: Vec3, items: string) {
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

      // コンテナを開く
      const container = await this.bot.openChest(block);
      const containerSlotCount = container.inventoryStart;
      const containerItems = container.slots
        .slice(0, containerSlotCount)
        .filter((item) => item !== null);

      // items引数をパース
      let itemsArray: { name: string; count?: number }[];
      try {
        itemsArray = JSON.parse(items);
        if (!Array.isArray(itemsArray))
          throw new Error('itemsは配列である必要があります');
      } catch (e) {
        await container.close();
        return {
          success: false,
          result:
            'items引数のJSONパースに失敗しました。形式: [{"name": "アイテム名", "count": 数}, ...]',
        };
      }

      let results: string[] = [];
      for (const req of itemsArray) {
        const targetItems = containerItems.filter(
          (item) =>
            item.name === req.name ||
            (item.displayName &&
              item.displayName.toLowerCase().includes(req.name.toLowerCase()))
        );
        if (targetItems.length === 0) {
          results.push(`"${req.name}" が見つかりませんでした。`);
          continue;
        }
        let remaining =
          req.count ?? targetItems.reduce((sum, item) => sum + item.count, 0);
        let withdrawn = 0;
        for (const item of targetItems) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, item.count);
          await container.withdraw(item.type, item.metadata, take);
          remaining -= take;
          withdrawn += take;
        }
        if (withdrawn === 0) {
          results.push(`"${req.name}" を取得できませんでした。`);
        } else if (req.count && withdrawn < req.count) {
          results.push(
            `"${req.name}" を ${withdrawn}個取得（要求: ${req.count}個）`
          );
        } else {
          results.push(`"${req.name}" を ${withdrawn}個取得`);
        }
      }
      await container.close();
      const containerType = block.name.includes('shulker')
        ? 'シュルカーボックス'
        : 'チェスト';
      return {
        success: true,
        result: `${containerType}から: ` + results.join(' / '),
      };
    } catch (error: any) {
      return {
        success: false,
        result: `コンテナからアイテムを取得中にエラーが発生しました: ${error.message}`,
      };
    }
  }
}

export default GetItemFromContainer;

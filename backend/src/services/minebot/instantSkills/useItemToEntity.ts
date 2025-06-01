import { InstantSkill, CustomBot } from '../types.js';
import pathfinder from 'mineflayer-pathfinder';
const { goals } = pathfinder;
import { Item } from 'prismarine-item';
import minecraftData from 'minecraft-data';

class UseItemToEntity extends InstantSkill {
  private mcData: any;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'use-item-to-entity';
    this.description =
      '指定したアイテムを指定したエンティティに対して使用します。牛から牛乳を取る際や魚をバケツで取る際などに使用します。';
    this.priority = 100;
    this.canUseByCommand = true;
    this.mcData = minecraftData(this.bot.version);
    this.params = [
      {
        name: 'itemName',
        description: '使用するアイテムの名前。例: bucket など',
        type: 'string',
      },
      {
        name: 'targetEntityName',
        description: '使用するエンティティの名前。例: cow, cod, など',
        type: 'string',
      },
      {
        name: 'itemCount',
        description: '使用するアイテムの数',
        type: 'number',
      },
    ];
  }

  async runImpl(itemName: string, targetEntityName: string, itemCount: number) {
    try {
      const Item = this.mcData.itemsByName[itemName];
      if (!Item) {
        return { success: false, result: `アイテム${itemName}はありません` };
      }
      const items = this.bot.inventory
        .items()
        .filter((i) => i.name === Item.name);
      if (items.length === 0) {
        return {
          success: false,
          result: `アイテム${itemName}がインベントリに見つかりません`,
        };
      }
      const inventoryItemCount = items.reduce(
        (acc, item) => acc + item.count,
        0
      );
      if (inventoryItemCount < itemCount) {
        return {
          success: false,
          result: `アイテム${itemName}が${inventoryItemCount}個しかありません`,
        };
      }
      const Entity = this.mcData.entitiesByName[targetEntityName];
      if (!Entity) {
        return {
          success: false,
          result: `エンティティ${targetEntityName}はありません`,
        };
      }
      let count = 0;
      while (count < itemCount) {
        const Entities = Object.values(this.bot.entities)
          .filter((entity) => {
            // 敵対的モブであり、指定された距離以内にあるかをチェック
            return (
              entity.name === Entity.name &&
              this.bot.entity.position.distanceTo(entity.position) <= 64
            );
          })
          .sort((a, b) => {
            return (
              this.bot.entity.position.distanceTo(a.position) -
              this.bot.entity.position.distanceTo(b.position)
            );
          });
        if (Entities.length === 0) {
          return {
            success: false,
            result: `周囲64ブロック以内に${targetEntityName}は見つかりませんでした`,
          };
        }
        let validEntities = Entities;

        // 最初の有効なエンティティを使用
        const entity = validEntities[0];
        await this.bot.pathfinder.goto(
          new goals.GoalNear(
            entity.position.x,
            entity.position.y,
            entity.position.z,
            3
          )
        );
        const item = this.bot.inventory
          .items()
          .find((i) => i.name === Item.name);
        await this.bot.equip(item as Item, 'hand');
        await this.bot.lookAt(entity.position.offset(0, entity.height, 0));
        await this.bot.useOn(entity);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        count++;
      }
      return {
        success: true,
        result: `アイテム${itemName}を${targetEntityName}に使用しました`,
      };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default UseItemToEntity;

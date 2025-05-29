import { CustomBot, InstantSkill } from '../types.js';
import { Vec3 } from 'vec3';
import { Item } from 'prismarine-item';

export class GetBlockDetailData extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'get-block-detail-data';
    this.description =
      '指定したブロックの詳細なデータを取得します。植物の成長度合い、かまどの中身、醸造台の中身、それ以外のブロックの詳細なデータなどを取得します。';
    this.priority = 10;
    this.params = [
      {
        name: 'blockPosition',
        type: 'Vec3',
        description: 'ブロックの位置',
      },
    ];
  }

  async run(blockPosition: Vec3) {
    try {
      const block = this.bot.blockAt(blockPosition);

      if (!block) {
        return {
          success: false,
          result: `座標 (${blockPosition.x}, ${blockPosition.y}, ${blockPosition.z}) にブロックが見つかりません。`,
        };
      }

      // ブロックの基本データを準備
      const blockDetailData: any = {
        name: block.name,
        position: {
          x: block.position.x,
          y: block.position.y,
          z: block.position.z,
        },
        stateId: block.stateId,
        properties: block.getProperties ? block.getProperties() : {},
        metadata: block.metadata,
      };

      // ブロックタイプ別の詳細データ取得
      if (block.name.includes('furnace')) {
        // かまどの場合
        try {
          const furnace = await this.bot.openFurnace(block);
          blockDetailData.furnaceData = {
            fuel: furnace.fuelItem()
              ? {
                  name: furnace.fuelItem().name,
                  count: furnace.fuelItem().count,
                }
              : null,
            inputItem: furnace.inputItem()
              ? {
                  name: furnace.inputItem().name,
                  count: furnace.inputItem().count,
                }
              : null,
            outputItem: furnace.outputItem()
              ? {
                  name: furnace.outputItem().name,
                  count: furnace.outputItem().count,
                }
              : null,
            fuelProgress: furnace.fuel,
            cookProgress: furnace.progress,
          };
          await furnace.close();
        } catch (error) {
          blockDetailData.furnaceData = {
            error: 'かまどを開けませんでした',
          };
        }
      } else if (block.name.includes('brewing_stand')) {
        // 醸造台の場合
        try {
          // Minecraft 1.12以降はBrewingStandが別のAPIになっている可能性があるため、
          // 通常のコンテナとして開いて中身を取得する
          const container = await this.bot.openContainer(block);
          const items = container.items().filter((item) => item !== null);
          blockDetailData.brewingStandData = {
            ingredients: items.map((item: Item) => ({
              name: item.name,
              count: item.count,
              slot: item.slot,
            })),
          };
          await container.close();
        } catch (error) {
          blockDetailData.brewingStandData = {
            error: '醸造台を開けませんでした',
          };
        }
      } else if (
        block.name.includes('dispenser') ||
        block.name.includes('dropper') ||
        block.name.includes('hopper')
      ) {
        // ディスペンサー/ドロッパー/ホッパーの場合
        try {
          const dispenser = await this.bot.openContainer(block);
          const items = dispenser.items().filter((item) => item !== null);
          blockDetailData.containerData = {
            type: block.name,
            items: items.map((item: Item) => ({
              name: item.name,
              count: item.count,
              slot: item.slot,
            })),
          };
          await dispenser.close();
        } catch (error) {
          blockDetailData.containerData = {
            error: 'コンテナを開けませんでした',
          };
        }
      }

      // 作物の成長度合いの詳細
      if (
        [
          'wheat',
          'carrots',
          'potatoes',
          'beetroots',
          'nether_wart',
          'cocoa',
        ].includes(block.name)
      ) {
        blockDetailData.cropData = {
          type: block.name,
          growthStage: blockDetailData.properties.age,
          isFullyGrown:
            block.name === 'nether_wart'
              ? blockDetailData.properties.age === '3'
              : block.name === 'beetroots'
              ? blockDetailData.properties.age === '3'
              : block.name === 'cocoa'
              ? blockDetailData.properties.age === '2'
              : blockDetailData.properties.age === '7',
        };
      }

      return {
        success: true,
        result: JSON.stringify(blockDetailData, null, 2),
      };
    } catch (error: any) {
      return {
        success: false,
        result: `ブロック詳細データの取得中にエラーが発生しました: ${error.message}`,
      };
    }
  }
}

export default GetBlockDetailData;

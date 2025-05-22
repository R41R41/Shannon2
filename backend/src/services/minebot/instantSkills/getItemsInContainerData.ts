import { CustomBot, InstantSkill } from '../types.js';
import { Vec3 } from 'vec3';
import fs from 'fs';
import path from 'path';

class GetItemsInContainerData extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'get-items-in-container-data';
    this.description = '指定した座標のチェストやコンテナの中身を確認します。';
    this.priority = 90;
    this.canUseByCommand = false;
    this.params = [
      {
        name: 'containerPosition',
        description: 'コンテナの座標',
        type: 'Vec3',
        required: true,
      },
    ];
  }

  async run(containerPosition: Vec3 | { x: number; y: number; z: number }) {
    try {
      // コンテナの座標を確認 (Vec3オブジェクトまたはx,y,z座標を含むオブジェクト)
      let containerPos: Vec3;

      if (containerPosition instanceof Vec3) {
        containerPos = containerPosition;
      } else if (
        containerPosition &&
        typeof containerPosition === 'object' &&
        'x' in containerPosition &&
        'y' in containerPosition &&
        'z' in containerPosition
      ) {
        // x, y, z座標を持つオブジェクトからVec3を作成
        containerPos = new Vec3(
          containerPosition.x,
          containerPosition.y,
          containerPosition.z
        );
      } else {
        console.error(
          'Invalid containerPosition:',
          JSON.stringify(containerPosition)
        );
        return {
          success: false,
          result: `コンテナの座標が正しく指定されていません: ${JSON.stringify(
            containerPosition
          )}`,
        };
      }

      console.log(`コンテナ座標: ${containerPos.toString()}`);

      // ボットの位置を取得
      const botPos = this.bot.entity.position;

      // コンテナまでの距離をチェック
      const distance = botPos.distanceTo(containerPos);
      console.log(`コンテナまでの距離: ${distance}ブロック`);

      if (distance > 3) {
        return {
          success: false,
          result: `コンテナが遠すぎます。距離: ${distance.toFixed(
            2
          )}ブロック（最大: 3ブロック）`,
        };
      }

      // ブロックを取得
      const blockAtPos = this.bot.blockAt(containerPos);
      if (!blockAtPos) {
        console.log(
          `指定された座標にブロックが見つかりません: ${containerPos.toString()}`
        );
        return {
          success: false,
          result: `指定された座標(${containerPos.x}, ${containerPos.y}, ${containerPos.z})にブロックが見つかりません`,
        };
      }

      console.log(`ブロックの種類: ${blockAtPos.name}`);

      // コンテナかどうかをチェック
      if (
        !blockAtPos.name.includes('chest') &&
        !blockAtPos.name.includes('barrel') &&
        !blockAtPos.name.includes('shulker')
      ) {
        return {
          success: false,
          result: `指定されたブロック(${blockAtPos.name})はコンテナではありません`,
        };
      }

      // コンテナを開く
      console.log(`コンテナを開こうとしています: ${blockAtPos.name}`);
      const container = await this.bot.openContainer(blockAtPos);

      // コンテナが開けなかった場合
      if (!container) {
        console.log('コンテナを開けませんでした');
        return {
          success: false,
          result: 'コンテナを開けませんでした',
        };
      }

      console.log(`コンテナを開きました: ${container.type}`);

      // アイテムの情報を取得
      const containerSlotCount = container.inventoryStart; // inventoryStartがコンテナスロット数
      const items = container.slots
        .slice(0, containerSlotCount)
        .filter((item) => item !== null)
        .map((item) => {
          return {
            name: item.name,
            count: item.count,
            displayName: item.displayName,
            slot: item.slot,
          };
        })
        .filter((item) => item !== null);

      console.log(`コンテナ内のアイテム数: ${items.length}`);

      // コンテナ情報を作成
      const containerInfo = {
        type: blockAtPos.name,
        position: {
          x: containerPos.x,
          y: containerPos.y,
          z: containerPos.z,
        },
        items: items,
      };

      // コンテナを閉じる
      await container.close();

      // JSON形式でファイルに保存
      const filePath = path.join(
        process.cwd(),
        'saves',
        'minecraft',
        'container_data.json'
      );
      fs.writeFileSync(filePath, JSON.stringify(containerInfo, null, 2));

      return {
        success: true,
        result: `チェストの中身：${JSON.stringify(containerInfo)}`,
      };
    } catch (error: any) {
      console.error('コンテナの中身取得中にエラーが発生:', error);
      return {
        success: false,
        result: `コンテナの中身取得中にエラーが発生しました: ${error.message}`,
      };
    }
  }
}

export default GetItemsInContainerData;

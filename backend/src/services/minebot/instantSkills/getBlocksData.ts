import { InstantSkill, CustomBot } from '../types.js';
import fs from 'fs';
import path from 'path';
import { Vec3 } from 'vec3';

class GetBlocksData extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'get-blocks-data';
    this.description =
      '周囲のブロックのデータを取得します。座標領域やブロックの名前を指定することもできます。ただし、ブロックの数が500個以上ある場合はエラーが出ます。';
    this.priority = 100;
    this.canUseByCommand = false;
    this.params = [
      {
        name: 'startPosition',
        description:
          '取得する開始座標。これを指定する際はblockNameはnullで指定してください。',
        type: 'Vec3',
        required: false,
        default: null,
      },
      {
        name: 'endPosition',
        description:
          '取得する終了座標。これを指定する際はblockNameはnullで指定してください。',
        type: 'Vec3',
        required: false,
        default: null,
      },
      {
        name: 'blockName',
        description:
          '取得するブロックの名前。これを指定する際はstartPositionとendPositionはnullで指定してください。',
        type: 'string',
        required: false,
        default: null,
      },
    ];
  }

  async run(
    startPosition: Vec3 | null = null,
    endPosition: Vec3 | null = null,
    blockName: string | null = null
  ) {
    // ブロックデータの収集開始
    try {
      const botPosition = this.bot.entity.position;

      // パラメータの検証
      if (!startPosition && !endPosition && !blockName) {
        return {
          success: false,
          result:
            'startPositionとendPositionの両方がnullの場合は、blockNameを指定する必要があります。',
        };
      }

      // 範囲が指定されていない場合、ボットの周囲64ブロック四方を検索範囲とする
      const searchRange = 32; // 片側32ブロックで合計64ブロック四方
      const start =
        startPosition ||
        new Vec3(
          Math.floor(botPosition.x) - (blockName ? searchRange : 5),
          Math.floor(botPosition.y) - (blockName ? searchRange : 3),
          Math.floor(botPosition.z) - (blockName ? searchRange : 5)
        );
      const end =
        endPosition ||
        new Vec3(
          Math.floor(botPosition.x) + (blockName ? searchRange : 5),
          Math.floor(botPosition.y) + (blockName ? searchRange : 5),
          Math.floor(botPosition.z) + (blockName ? searchRange : 5)
        );

      const blocksInfo = [];
      // 指定範囲内のブロックをスキャン
      for (let x = start.x; x <= end.x; x++) {
        for (let y = start.y; y <= end.y; y++) {
          for (let z = start.z; z <= end.z; z++) {
            const position = new Vec3(x, y, z);
            const block = this.bot.blockAt(position);

            if (block && block.name !== 'air') {
              // blockNameが指定されている場合、一致するブロックのみを追加
              if (blockName && block.name !== blockName) {
                continue;
              }

              // ブロックの詳細プロパティを取得
              const blockProperties = {
                name: block.name,
                position: {
                  x: block.position.x,
                  y: block.position.y,
                  z: block.position.z,
                },
                stateId: block.stateId,
                properties: block.getProperties ? block.getProperties() : {},
              };

              blocksInfo.push(blockProperties);
            }
          }
        }
      }

      if (blocksInfo.length > 500) {
        return {
          success: false,
          result:
            'ブロックの数が500個以上あるため表示できません。もっと領域を絞ってください。',
        };
      }

      if (blocksInfo.length === 0) {
        return {
          success: true,
          result: blockName
            ? `指定された名前「${blockName}」のブロックは見つかりませんでした。`
            : '指定された範囲内にブロックが見つかりませんでした。',
        };
      }

      // JSON形式でファイルに保存
      const filePath = path.join(
        process.cwd(),
        'saves',
        'minecraft',
        'blocks_data.json'
      );
      fs.writeFileSync(filePath, JSON.stringify(blocksInfo, null, 2));
      return {
        success: true,
        result: `ブロックデータ：${JSON.stringify(blocksInfo)}`,
      };
    } catch (error: any) {
      return { success: false, result: error.message };
    }
  }
}

export default GetBlocksData;

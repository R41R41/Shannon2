import pathfinder from 'mineflayer-pathfinder';
import { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';
import HoldItem from './holdItem.js';
const { goals } = pathfinder;

class PlaceBlock extends InstantSkill {
  private holdItem: HoldItem;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'place-block';
    this.description = '指定したブロックを置きます';
    this.holdItem = new HoldItem(bot);
    this.params = [
      {
        name: 'blockName',
        type: 'string',
        description:
          '置くブロックの名前。例: cobblestone, dirt, crafting_tableなど',
        default: 'null',
      },
      {
        name: 'placePosition',
        type: 'Vec3',
        description: 'ブロックを置く座標',
        required: false,
      },
      {
        name: 'placedBlockPosition',
        type: 'Vec3',
        description:
          'ブロックを面で接するように置く先の既に置いてあるブロックの座標',
        required: false,
      },
      {
        name: 'autoPlace',
        type: 'boolean',
        description:
          '座標を指定せずに自動で近くの設置可能な場所を適当に探してブロックを置く。ただし、ブロックが置ける場所が見つからない場合はfalseを返す。',
        required: false,
        default: false,
      },
    ];
  }

  async runImpl(
    blockName: string,
    placePosition: any,
    placedBlockPosition: any,
    autoPlace: boolean = false
  ) {
    console.log(
      'placeBlock',
      blockName,
      placePosition,
      placedBlockPosition,
      autoPlace
    );
    try {
      let placePositionVec3 = this.parseVec3(placePosition);
      let placedBlockPositionVec3 = this.parseVec3(placedBlockPosition);

      // autoPlaceオプションが有効な場合は自動探索
      if (autoPlace) {
        const result = await this.autoFindPlace();
        if (!result.success) {
          return {
            success: false,
            result: '近くに設置可能な空間が見つかりませんでした。',
          };
        }
        placePositionVec3 = result.result.placePositionVec3;
        placedBlockPositionVec3 = result.result.placedBlockPositionVec3;
      }

      if (!placePositionVec3 || !placedBlockPositionVec3) {
        return { success: false, result: '座標の形式が正しくありません。' };
      }

      const placeblock = this.bot.blockAt(placePositionVec3);
      if (
        !placeblock?.name.includes('air') &&
        !placeblock?.name.includes('void') &&
        !placeblock?.name.includes('water') &&
        !placeblock?.name.includes('lava') &&
        !placeblock?.name.includes('grass') &&
        !placeblock?.name.includes('tall_grass')
      ) {
        return {
          success: false,
          result: `${placePositionVec3}に設置可能な空間がありません。get-blocks-dataツールで確認してください。`,
        };
      }
      const placedBlock = this.bot.blockAt(placedBlockPositionVec3);
      if (
        placedBlock?.name.includes('air') ||
        placedBlock?.name.includes('void') ||
        placedBlock?.name.includes('water')
      ) {
        return {
          success: false,
          result: `${placedBlockPositionVec3}に設置するために隣接するブロックがありません。get-blocks-dataツールで確認してください。`,
        };
      }
      const response = await this.holdItem.run(blockName, false);
      if (!response.success) {
        return response;
      }
      const relativePosition = placePositionVec3.minus(placedBlockPositionVec3);
      if (
        !(
          (Math.abs(relativePosition.x) === 1 &&
            relativePosition.y === 0 &&
            relativePosition.z === 0) ||
          (relativePosition.x === 0 &&
            Math.abs(relativePosition.y) === 1 &&
            relativePosition.z === 0) ||
          (relativePosition.x === 0 &&
            relativePosition.y === 0 &&
            Math.abs(relativePosition.z) === 1)
        )
      ) {
        return {
          success: false,
          result:
            'ブロックを置く座標と既に置いてあるブロックの座標の差は単位ベクトルでなければなりません。',
        };
      }

      // ブロック設置のために近づく
      try {
        const botPos = this.bot.entity.position;
        if (
          Math.floor(botPos.x) === Math.floor(placePositionVec3.x) &&
          Math.floor(botPos.y) === Math.floor(placePositionVec3.y) &&
          Math.floor(botPos.z) === Math.floor(placePositionVec3.z)
        ) {
          // どく先の座標を決定（例: 1ブロック東へ）
          const escapeOffsets = [
            new Vec3(1, 0, 0),
            new Vec3(-1, 0, 0),
            new Vec3(0, 0, 1),
            new Vec3(0, 0, -1),
            new Vec3(1, 1, 0),
            new Vec3(0, 1, 1),
            new Vec3(-1, 1, 0),
            new Vec3(0, 1, -1),
          ];
          let escaped = false;
          for (const offset of escapeOffsets) {
            const escapePos = placePositionVec3.plus(offset);
            const blockAtEscape = this.bot.blockAt(escapePos);
            if (blockAtEscape && blockAtEscape.name === 'air') {
              try {
                await this.bot.pathfinder.goto(
                  new goals.GoalNear(escapePos.x, escapePos.y, escapePos.z, 0)
                );
                // 少し待機
                await new Promise((resolve) => setTimeout(resolve, 250));
                escaped = true;
                break;
              } catch (moveError) {
                // 移動失敗時は次の候補へ
                continue;
              }
            }
          }
          if (!escaped) {
            return {
              success: false,
              result:
                '設置予定座標にbotがいるため、どくことができませんでした。',
            };
          }
        } else {
          await this.bot.pathfinder.goto(
            new goals.GoalNear(
              placedBlockPositionVec3.x,
              placedBlockPositionVec3.y,
              placedBlockPositionVec3.z,
              2
            )
          );
        }
        await this.bot.lookAt(placePositionVec3);
      } catch (moveError: any) {
        console.error('移動に失敗しました:', moveError);
        return {
          success: false,
          result: `ブロックを設置する場所まで移動できませんでした: ${moveError.message}`,
        };
      }

      // ブロックまでの距離を確認
      const botPosition = this.bot.entity.position;
      const distanceToBlock = botPosition.distanceTo(placedBlockPositionVec3);
      if (distanceToBlock > 4) {
        return {
          success: false,
          result: `ブロックを設置する場所が遠すぎます（距離: ${distanceToBlock.toFixed(
            2
          )}ブロック）。より近くに移動してください。`,
        };
      }

      try {
        // タイムアウト対策としてプロミスに10秒の制限を設ける
        const placePromise = this.bot.placeBlock(
          placedBlock as Block,
          relativePosition
        );
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('ブロック設置がタイムアウトしました')),
            10000
          )
        );

        await Promise.race([placePromise, timeoutPromise]);
        return {
          success: true,
          result: `${blockName}を${placePositionVec3}に置きました。`,
        };
      } catch (placeError: any) {
        console.error('ブロック設置に失敗しました:', placeError);

        // より詳細なエラーメッセージを提供
        if (placeError.message.includes('timeout')) {
          return {
            success: false,
            result: `ブロック設置がタイムアウトしました。ブロックが到達可能な範囲内にあるか確認してください。`,
          };
        } else {
          return {
            success: false,
            result: `ブロック設置に失敗しました: ${placeError.message}`,
          };
        }
      }
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }

  private async autoFindPlace(): Promise<{
    success: boolean;
    result: {
      placePositionVec3: Vec3 | null;
      placedBlockPositionVec3: Vec3 | null;
    };
  }> {
    const IGNORE_BLOCKS = [
      'air',
      'cave_air',
      'void',
      'water',
      'lava',
      'grass',
      'tall_grass',
    ];
    const botPos = this.bot.entity.position;
    const candidates: {
      placePositionVec3: Vec3;
      placedBlockPositionVec3: Vec3;
    }[] = [];
    for (let dx = -4; dx <= 4; dx++) {
      for (let dy = -2; dy <= 4; dy++) {
        for (let dz = -4; dz <= 4; dz++) {
          const pos = botPos.offset(dx, dy, dz).floored();
          // 自分が占めている空間は除外
          if (
            Math.floor(botPos.x) === pos.x &&
            Math.floor(botPos.y) === pos.y &&
            Math.floor(botPos.z) === pos.z
          )
            continue;
          // 他のエンティティが占めていないかチェック
          let occupied = false;
          for (const entity of Object.values(this.bot.entities)) {
            if (
              Math.floor(entity.position.x) === pos.x &&
              Math.floor(entity.position.y) === pos.y &&
              Math.floor(entity.position.z) === pos.z
            ) {
              occupied = true;
              break;
            }
          }
          if (occupied) continue;
          const blockAtPos = this.bot.blockAt(pos);
          if (!blockAtPos || !IGNORE_BLOCKS.includes(blockAtPos.name)) continue;
          // その下のブロック
          const below = pos.offset(0, -1, 0);
          const blockBelow = this.bot.blockAt(below);
          if (!blockBelow || IGNORE_BLOCKS.includes(blockBelow.name)) continue;
          candidates.push({
            placePositionVec3: pos,
            placedBlockPositionVec3: below,
          });
        }
      }
    }
    // 近い順にソート
    candidates.sort(
      (a, b) =>
        botPos.distanceTo(a.placePositionVec3) -
        botPos.distanceTo(b.placePositionVec3)
    );
    // 最も近い候補を返す
    if (candidates.length > 0) {
      return {
        success: true,
        result: {
          placePositionVec3: candidates[0].placePositionVec3,
          placedBlockPositionVec3: candidates[0].placedBlockPositionVec3,
        },
      };
    }
    return {
      success: false,
      result: { placePositionVec3: null, placedBlockPositionVec3: null },
    };
  }

  // 文字列やオブジェクトからVec3オブジェクトに変換する関数
  private parseVec3(input: any): Vec3 | null {
    try {
      // すでにVec3オブジェクトの場合
      if (input instanceof Vec3) {
        return input;
      }

      // 文字列の場合（例: "0,0,0"）
      if (typeof input === 'string') {
        const coords = input.split(',').map((v) => parseFloat(v.trim()));
        if (
          coords.length === 3 &&
          !isNaN(coords[0]) &&
          !isNaN(coords[1]) &&
          !isNaN(coords[2])
        ) {
          return new Vec3(coords[0], coords[1], coords[2]);
        }
      }

      // オブジェクトの場合（例: {x: 0, y: 0, z: 0}）
      if (
        typeof input === 'object' &&
        input !== null &&
        'x' in input &&
        'y' in input &&
        'z' in input
      ) {
        const x = parseFloat(input.x);
        const y = parseFloat(input.y);
        const z = parseFloat(input.z);
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
          return new Vec3(x, y, z);
        }
      }

      return null;
    } catch (error) {
      console.error('Vec3のパースに失敗しました:', error);
      return null;
    }
  }
}

export default PlaceBlock;

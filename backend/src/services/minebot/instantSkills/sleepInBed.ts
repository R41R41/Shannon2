import { InstantSkill, CustomBot } from '../types.js';
import pathfinder from 'mineflayer-pathfinder';
const { goals } = pathfinder;
import { Vec3 } from 'vec3';

class SleepInBed extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'sleep-in-bed';
    this.description =
      'ベッドで眠ります。ベッドがない場合はベッドを設置して眠ります。';
    this.status = false;
  }

  // ベッドを設置できる場所を探す
  async findPlaceForBed(): Promise<Vec3 | null> {
    // プレイヤーの近くを探索
    const startPos = this.bot.entity.position.clone();
    const searchRadius = 5;

    for (let x = -searchRadius; x <= searchRadius; x++) {
      for (let z = -searchRadius; z <= searchRadius; z++) {
        for (let y = -1; y <= 1; y++) {
          const pos = startPos.offset(x, y, z).floored();

          // ベッドを設置するには2つの空きブロックと下に固体ブロックが必要
          const blockPos = this.bot.blockAt(pos);
          let blockPosHead = this.bot.blockAt(pos.offset(1, 0, 0));
          const blockBelow = this.bot.blockAt(pos.offset(0, -1, 0));
          let blockBelowHead = this.bot.blockAt(pos.offset(1, -1, 0));

          // 設置場所と頭部位置のブロックが空気で、下のブロックが固体かどうか確認
          if (blockPos && blockPosHead && blockBelow && blockBelowHead) {
            if (
              (blockPos.name === 'air' || blockPos.name === 'cave_air') &&
              (blockPosHead.name === 'air' ||
                blockPosHead.name === 'cave_air') &&
              blockBelow.name !== 'air' &&
              blockBelow.name !== 'cave_air' &&
              blockBelowHead.name !== 'air' &&
              blockBelowHead.name !== 'cave_air'
            ) {
              return pos;
            }
          }

          // 別方向も試す (z方向)
          blockPosHead = this.bot.blockAt(pos.offset(0, 0, 1));
          blockBelowHead = this.bot.blockAt(pos.offset(0, -1, 1));

          if (blockPos && blockPosHead && blockBelow && blockBelowHead) {
            if (
              (blockPos.name === 'air' || blockPos.name === 'cave_air') &&
              (blockPosHead.name === 'air' ||
                blockPosHead.name === 'cave_air') &&
              blockBelow.name !== 'air' &&
              blockBelow.name !== 'cave_air' &&
              blockBelowHead.name !== 'air' &&
              blockBelowHead.name !== 'cave_air'
            ) {
              return pos;
            }
          }
        }
      }
    }

    return null;
  }

  async run() {
    try {
      // まず近くにベッドがあるか探す
      const bed = this.bot.findBlock({
        matching: this.bot.isABed,
        maxDistance: 16, // 近い範囲で探索
      });

      if (bed) {
        // すでにベッドがある場合は、そこに移動して寝る
        try {
          await this.bot.pathfinder.goto(
            new goals.GoalNear(
              bed.position.x,
              bed.position.y,
              bed.position.z,
              2
            )
          );
          await this.bot.sleep(bed);
          return { success: true, result: '既存のベッドで眠りました' };
        } catch (error: any) {
          return {
            success: false,
            result: `ベッドで眠ることができませんでした: ${error.message}`,
          };
        }
      }

      // インベントリにベッドがあるか確認
      const bedItem = this.bot.inventory
        .items()
        .find((i) => i.name.includes('bed'));
      if (!bedItem) {
        return {
          success: false,
          result:
            'インベントリにベッドがなく、周囲にもベッドが見つかりませんでした',
        };
      }

      // ベッドを設置できる場所を探す
      const placePos = await this.findPlaceForBed();
      if (!placePos) {
        return {
          success: false,
          result: 'ベッドを設置できる適切な場所が見つかりませんでした',
        };
      }

      // 設置場所に移動
      await this.bot.pathfinder.goto(
        new goals.GoalNear(placePos.x, placePos.y, placePos.z, 2)
      );

      // ベッドを手に持つ
      await this.bot.equip(bedItem, 'hand');

      // 設置場所の下のブロックを参照ブロックとして使用
      const referenceBlock = this.bot.blockAt(placePos.offset(0, -1, 0));
      if (!referenceBlock) {
        return {
          success: false,
          result: 'ベッドを設置するための参照ブロックが見つかりませんでした',
        };
      }

      // ベッドを設置
      await this.bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));

      await new Promise((resolve) => setTimeout(resolve, 500));

      // 設置したベッドを探す
      const placedBed = this.bot.findBlock({
        matching: this.bot.isABed,
        maxDistance: 3, // 近い範囲で探索
      });

      if (!placedBed) {
        return { success: false, result: 'ベッドの設置に失敗しました' };
      }

      // ベッドで寝る
      await this.bot.sleep(placedBed);
      return { success: true, result: 'ベッドを設置して眠りました' };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default SleepInBed;

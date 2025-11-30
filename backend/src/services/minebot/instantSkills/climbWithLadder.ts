import pathfinder from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';
import HoldItem from './holdItem.js';
const { goals } = pathfinder;

class ClimbWithLadder extends InstantSkill {
  private holdItem: HoldItem;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'climb-with-ladder';
    this.description = 'ハシゴを設置しながら指定した座標まで登ります';
    this.params = [
      {
        name: 'targetPosition',
        description: '登る先の座標',
        type: 'Vec3',
        required: true,
      },
    ];
    this.holdItem = new HoldItem(bot);
  }

  async runImpl(targetPosition: Vec3) {
    try {
      const startPos = this.bot.entity.position.floored();
      const endPos = new Vec3(
        targetPosition.x,
        targetPosition.y,
        targetPosition.z
      ).floored();

      if (endPos.y <= startPos.y) {
        return {
          success: false,
          result: '目標座標は現在位置より上にある必要があります',
        };
      }

      // ハシゴを持っているか確認（oak_ladder などの派生アイテムも含む）
      const ladderItem = this.bot.inventory
        .items()
        .find((i) => i.name.includes('ladder'));
      if (!ladderItem) {
        return { success: false, result: 'インベントリにハシゴがありません' };
      }

      const ladderColumnPos = new Vec3(endPos.x, startPos.y, endPos.z);
      // 上下に向かう範囲
      const minY = startPos.y;
      const maxY = endPos.y;

      const directions = [
        new Vec3(1, 0, 0), // +X
        new Vec3(-1, 0, 0), // -X
        new Vec3(0, 0, 1), // +Z
        new Vec3(0, 0, -1), // -Z
      ];

      // サポートブロックとなる縦方向のカラムを探索
      let supportDir: Vec3 | null = null;
      for (const dir of directions) {
        let valid = true;
        for (let y = minY; y <= maxY; y++) {
          const ladderPos = new Vec3(ladderColumnPos.x, y, ladderColumnPos.z);
          const supportPos = ladderPos.plus(dir);

          // サポート側: 何か実体のあるブロックが必要
          const supportBlock = this.bot.blockAt(supportPos);
          if (
            !supportBlock ||
            supportBlock.name === 'air' ||
            supportBlock.name === 'cave_air' ||
            supportBlock.name === 'void' ||
            supportBlock.boundingBox === 'empty'
          ) {
            valid = false;
            break;
          }

          // ラダー側: 空気 もしくは 既にハシゴ があること
          const ladderBlock = this.bot.blockAt(ladderPos);
          if (
            ladderBlock &&
            !ladderBlock.name.includes('ladder') &&
            ladderBlock.name !== 'air' &&
            ladderBlock.name !== 'cave_air' &&
            ladderBlock.name !== 'void'
          ) {
            // 固体ブロック等で埋まっている場合は無効
            valid = false;
            break;
          }
        }
        if (valid) {
          supportDir = dir;
          break;
        }
      }

      if (!supportDir) {
        return {
          success: false,
          result: 'ハシゴを掛けられる縦の壁が見つかりません',
        };
      }

      // 移動して下部に到達
      try {
        await this.bot.pathfinder.goto(
          new goals.GoalNear(
            ladderColumnPos.x,
            ladderColumnPos.y,
            ladderColumnPos.z,
            1
          )
        );
      } catch (moveErr: any) {
        return {
          success: false,
          result: `開始位置まで移動できません: ${moveErr.message}`,
        };
      }

      // ハシゴを手に持つ
      await this.holdItem.run(ladderItem.name, false);

      let currentY = minY - 1;
      // 1 段ずつ設置 → 登攀 を繰り返す
      await this.bot.waitForTicks(1);
      while (currentY < maxY) {
        await this.holdItem.run(ladderItem.name, false);
        // --- 次の高さ(一段上)にハシゴが無ければ設置 ---
        const nextY = currentY + 1;
        if (nextY <= maxY) {
          const nextPos = new Vec3(ladderColumnPos.x, nextY, ladderColumnPos.z);
          const nextBlock = this.bot.blockAt(nextPos);
          if (!nextBlock || !nextBlock.name.includes('ladder')) {
            const refPos = nextPos.plus(supportDir!);
            const refBlock = this.bot.blockAt(refPos);
            if (!refBlock) {
              return { success: false, result: '参照ブロックが見つかりません' };
            }
            try {
              // await this.bot.lookAt(nextPos.clone().plus(new Vec3(0.5, 0.5, 0.5)));
              await this.bot.placeBlock(refBlock, nextPos.minus(refPos));
              await this.bot.waitForTicks(1);
            } catch (err: any) {
              return { success: false, result: `ハシゴ設置失敗: ${err.message}` };
            }
          }
        }

        // --- 一段上へ登る ---!
        // パスファインダーで次の段に向かいつつ、登攀用に forward / jump を押しっぱなしにする
        this.bot.setControlState('forward', true);
        this.bot.setControlState('jump', true);
        try {
          await this.bot.pathfinder.goto(
            new goals.GoalNear(ladderColumnPos.x, nextY, ladderColumnPos.z, 0)
          );
        } catch (climbErr: any) {
          return {
            success: false,
            result: `ハシゴを登れませんでした: ${climbErr.message}`,
          };
        }

        currentY = nextY;
      }

      // 最終的に目的座標の周辺にいるか確認（念のため）
      if (this.bot.entity.position.y < maxY - 0.5) {
        try {
          await this.bot.pathfinder.goto(
            new goals.GoalNear(endPos.x, endPos.y, endPos.z, 1)
          );
        } catch (climbErr: any) {
          // 目的地点へ到達できなくても上まで登れていれば成功として扱う
        }
      }

      return {
        success: true,
        result: `ハシゴを設置して ${endPos.toString()} まで登りました`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `ハシゴ登り中にエラー発生: ${error.message}`,
      };
    }
  }
}

export default ClimbWithLadder;

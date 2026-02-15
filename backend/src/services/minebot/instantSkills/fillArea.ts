import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: エリアを特定ブロックで埋める
 */
class FillArea extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'fill-area';
    this.description =
      '指定した範囲を特定のブロックで埋めます（整地や簡単な建築に使用）。';
    this.params = [
      {
        name: 'x1',
        type: 'number',
        description: '開始X座標',
        required: true,
      },
      {
        name: 'y1',
        type: 'number',
        description: '開始Y座標',
        required: true,
      },
      {
        name: 'z1',
        type: 'number',
        description: '開始Z座標',
        required: true,
      },
      {
        name: 'x2',
        type: 'number',
        description: '終了X座標',
        required: true,
      },
      {
        name: 'y2',
        type: 'number',
        description: '終了Y座標',
        required: true,
      },
      {
        name: 'z2',
        type: 'number',
        description: '終了Z座標',
        required: true,
      },
      {
        name: 'blockName',
        type: 'string',
        description: '設置するブロック名',
        required: true,
      },
    ];
  }

  async runImpl(
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    blockName: string
  ) {
    try {
      // パラメータチェック
      if (
        !Number.isFinite(x1) ||
        !Number.isFinite(y1) ||
        !Number.isFinite(z1) ||
        !Number.isFinite(x2) ||
        !Number.isFinite(y2) ||
        !Number.isFinite(z2)
      ) {
        return {
          success: false,
          result: '座標は有効な数値である必要があります',
        };
      }

      // ブロック数の計算
      const dx = Math.abs(x2 - x1) + 1;
      const dy = Math.abs(y2 - y1) + 1;
      const dz = Math.abs(z2 - z1) + 1;
      const totalBlocks = dx * dy * dz;

      // 安全チェック（最大100ブロック）
      if (totalBlocks > 100) {
        return {
          success: false,
          result: `範囲が大きすぎます（${totalBlocks}ブロック、最大100ブロックまで）`,
        };
      }

      // ブロックの所持数チェック
      const item = this.bot.inventory
        .items()
        .find((item) => item.name === blockName);

      if (!item) {
        return {
          success: false,
          result: `${blockName}を持っていません`,
        };
      }

      if (item.count < totalBlocks) {
        return {
          success: false,
          result: `${blockName}が不足しています（必要: ${totalBlocks}個、所持: ${item.count}個）`,
        };
      }

      // 範囲の正規化
      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);
      const minZ = Math.min(z1, z2);
      const maxZ = Math.max(z1, z2);

      // ブロックを順次設置
      let placedCount = 0;

      for (let x = minX; x <= maxX; x++) {
        // 中断チェック（外側ループで確認）
        if (this.shouldInterrupt()) {
          return {
            success: placedCount > 0,
            result: `中断: ${placedCount}個のブロックを設置しました`,
          };
        }

        for (let y = minY; y <= maxY; y++) {
          for (let z = minZ; z <= maxZ; z++) {
            const pos = new Vec3(x, y, z);
            const block = this.bot.blockAt(pos);

            // 既にブロックがある場合はスキップ
            if (block && block.name !== 'air') {
              continue;
            }

            // 距離チェック（5m以内）
            const distance = this.bot.entity.position.distanceTo(pos);
            if (distance > 5) {
              return {
                success: false,
                result: `座標(${x}, ${y}, ${z})が遠すぎます（距離: ${distance.toFixed(
                  1
                )}m）。${placedCount}個設置して中断しました`,
              };
            }

            try {
              // 参照ブロックを探す（隣接するブロック）
              const referenceBlock = this.bot.blockAt(pos.offset(0, -1, 0));
              if (!referenceBlock || referenceBlock.name === 'air') {
                // 下にブロックがない場合は他の隣接ブロックを探す
                const offsets = [
                  [1, 0, 0],
                  [-1, 0, 0],
                  [0, 0, 1],
                  [0, 0, -1],
                ];
                let foundReference = false;

                for (const [ox, oy, oz] of offsets) {
                  const ref = this.bot.blockAt(pos.offset(ox, oy, oz));
                  if (ref && ref.name !== 'air') {
                    foundReference = true;
                    break;
                  }
                }

                if (!foundReference) {
                  continue; // 参照ブロックがない場合はスキップ
                }
              }

              // ブロックを設置
              await this.bot.equip(item, 'hand');
              await this.bot.placeBlock(
                this.bot.blockAt(pos.offset(0, -1, 0))!,
                new Vec3(0, 1, 0)
              );
              placedCount++;
            } catch (error) {
              // 設置に失敗した場合はスキップ
              continue;
            }
          }
        }
      }

      if (placedCount === 0) {
        return {
          success: false,
          result: '設置可能な場所がありませんでした',
        };
      }

      return {
        success: true,
        result: `${blockName}を${placedCount}個設置しました（範囲: (${minX},${minY},${minZ})〜(${maxX},${maxY},${maxZ})）`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `エリア埋めエラー: ${error.message}`,
      };
    }
  }
}

export default FillArea;

import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';
import { SkillParam } from '../types/skillParams.js';

/**
 * スキル①: 指定した始点と終点の座標範囲内のブロック情報を取得
 * 効率的な圧縮表現でLLMに渡す
 */
class GetBlocksInArea extends InstantSkill {
  skillName = 'get-blocks-in-area';
  description =
    '指定した始点と終点の座標範囲内のブロック情報を取得します。レイヤー形式または統計形式で出力できます。';
  params: SkillParam[] = [
    {
      name: 'x1',
      type: 'number' as const,
      description: '始点のX座標',
      required: true,
    },
    {
      name: 'y1',
      type: 'number' as const,
      description: '始点のY座標',
      required: true,
    },
    {
      name: 'z1',
      type: 'number' as const,
      description: '始点のZ座標',
      required: true,
    },
    {
      name: 'x2',
      type: 'number' as const,
      description: '終点のX座標',
      required: true,
    },
    {
      name: 'y2',
      type: 'number' as const,
      description: '終点のY座標',
      required: true,
    },
    {
      name: 'z2',
      type: 'number' as const,
      description: '終点のZ座標',
      required: true,
    },
    {
      name: 'format',
      type: 'string' as const,
      description:
        '出力形式: "layers"（レイヤー別の2D配列）, "stats"（統計情報）, "list"（座標リスト）',
      default: 'layers',
    },
    {
      name: 'includeAir',
      type: 'boolean' as const,
      description: '空気ブロックを含めるか（デフォルト: false）',
      default: false,
    },
  ];
  isToolForLLM = true;

  constructor(bot: CustomBot) {
    super(bot);
  }

  async runImpl(
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    format: string = 'layers',
    includeAir: boolean = false
  ) {
    try {
      // 座標を整数化
      const minX = Math.floor(Math.min(x1, x2));
      const maxX = Math.floor(Math.max(x1, x2));
      const minY = Math.floor(Math.min(y1, y2));
      const maxY = Math.floor(Math.max(y1, y2));
      const minZ = Math.floor(Math.min(z1, z2));
      const maxZ = Math.floor(Math.max(z1, z2));

      const width = maxX - minX + 1;
      const height = maxY - minY + 1;
      const length = maxZ - minZ + 1;
      const totalBlocks = width * height * length;

      // 範囲が大きすぎる場合は警告
      if (totalBlocks > 10000) {
        return {
          success: false,
          result: `範囲が大きすぎます（${totalBlocks}ブロック）。10,000ブロック以内にしてください。`,
        };
      }

      // ブロックデータを収集
      const blocks: Record<string, string> = {};
      let airCount = 0;
      let solidCount = 0;

      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          for (let z = minZ; z <= maxZ; z++) {
            const pos = new Vec3(x, y, z);
            const block = this.bot.blockAt(pos);

            if (!block) continue;

            const key = `${x},${y},${z}`;
            blocks[key] = block.name;

            if (block.name === 'air') {
              airCount++;
            } else {
              solidCount++;
            }
          }
        }
      }

      // フォーマットに応じて出力
      switch (format) {
        case 'layers':
          return this.formatAsLayers(
            blocks,
            minX,
            maxX,
            minY,
            maxY,
            minZ,
            maxZ,
            includeAir
          );
        case 'stats':
          return this.formatAsStats(
            blocks,
            minX,
            maxX,
            minY,
            maxY,
            minZ,
            maxZ,
            airCount,
            solidCount
          );
        case 'list':
          return this.formatAsList(blocks, includeAir);
        default:
          return {
            success: false,
            result: `不明なフォーマット: ${format}。"layers", "stats", "list"のいずれかを指定してください。`,
          };
      }
    } catch (error: any) {
      return {
        success: false,
        result: `エラー: ${error.message}`,
      };
    }
  }

  /**
   * レイヤー形式（高さ別の2D配列）
   * 建築タスクに最適
   */
  private formatAsLayers(
    blocks: Record<string, string>,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    minZ: number,
    maxZ: number,
    includeAir: boolean
  ) {
    const layers = [];

    for (let y = minY; y <= maxY; y++) {
      const layerData: string[] = [];

      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          const key = `${x},${y},${z}`;
          const blockName = blocks[key] || 'air';

          if (!includeAir && blockName === 'air') {
            layerData.push('.');
          } else {
            // ブロック名を短縮（最初の文字 + 番号など）
            layerData.push(this.abbreviateBlockName(blockName));
          }
        }
      }

      // レイヤーを文字列で表現（トークン節約）
      const width = maxX - minX + 1;
      const rows = [];
      for (let z = 0; z <= maxZ - minZ; z++) {
        const row = layerData.slice(z * width, (z + 1) * width).join('');
        rows.push(row);
      }

      layers.push({
        y,
        data: rows.join('\n'),
      });
    }

    // 記号の凡例を作成
    const legend = this.createLegend(blocks);

    const result = {
      format: 'layers',
      area: {
        min: { x: minX, y: minY, z: minZ },
        max: { x: maxX, y: maxY, z: maxZ },
        dimensions: {
          width: maxX - minX + 1,
          height: maxY - minY + 1,
          length: maxZ - minZ + 1,
        },
      },
      legend,
      layers,
      note: '各レイヤーは上から見た2D配列です。記号の意味はlegendを参照してください。',
    };

    return {
      success: true,
      result: JSON.stringify(result, null, 2),
    };
  }

  /**
   * 統計形式（ブロックタイプごとのカウント）
   */
  private formatAsStats(
    blocks: Record<string, string>,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    minZ: number,
    maxZ: number,
    airCount: number,
    solidCount: number
  ) {
    const stats: Record<string, number> = {};

    for (const blockName of Object.values(blocks)) {
      stats[blockName] = (stats[blockName] || 0) + 1;
    }

    const sortedStats = Object.entries(stats)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ block: name, count }));

    const result = {
      format: 'stats',
      area: {
        min: { x: minX, y: minY, z: minZ },
        max: { x: maxX, y: maxY, z: maxZ },
        dimensions: {
          width: maxX - minX + 1,
          height: maxY - minY + 1,
          length: maxZ - minZ + 1,
        },
      },
      totalBlocks: airCount + solidCount,
      airCount,
      solidCount,
      density: `${Math.round((solidCount / (solidCount + airCount)) * 100)}%`,
      blockTypes: sortedStats,
    };

    return {
      success: true,
      result: JSON.stringify(result, null, 2),
    };
  }

  /**
   * リスト形式（空気以外のブロックの座標リスト）
   */
  private formatAsList(blocks: Record<string, string>, includeAir: boolean) {
    const list = Object.entries(blocks)
      .filter(([_, name]) => includeAir || name !== 'air')
      .map(([coord, name]) => {
        const [x, y, z] = coord.split(',').map(Number);
        return { position: { x, y, z }, block: name };
      })
      .slice(0, 100); // 最大100個まで

    const result = {
      format: 'list',
      count: list.length,
      blocks: list,
      note: list.length === 100 ? '結果が100個に制限されています' : undefined,
    };

    return {
      success: true,
      result: JSON.stringify(result, null, 2),
    };
  }

  /**
   * ブロック名を短縮記号に変換
   */
  private abbreviateBlockName(name: string): string {
    const commonAbbreviations: Record<string, string> = {
      air: '.',
      stone: 'S',
      grass_block: 'G',
      dirt: 'D',
      oak_log: 'L',
      oak_planks: 'P',
      oak_leaves: 'F',
      water: 'W',
      glass: 'g',
      cobblestone: 'C',
      bedrock: 'B',
      coal_ore: 'o',
      iron_ore: 'i',
      gold_ore: 'g',
      diamond_ore: 'd',
      sand: 's',
      gravel: 'v',
    };

    return commonAbbreviations[name] || name.charAt(0).toUpperCase();
  }

  /**
   * 凡例を作成
   */
  private createLegend(blocks: Record<string, string>): Record<string, string> {
    const uniqueBlocks = new Set(Object.values(blocks));
    const legend: Record<string, string> = {};

    for (const blockName of uniqueBlocks) {
      legend[this.abbreviateBlockName(blockName)] = blockName;
    }

    return legend;
  }
}

export default GetBlocksInArea;

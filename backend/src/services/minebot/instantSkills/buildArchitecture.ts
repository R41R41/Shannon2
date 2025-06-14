import fs from 'fs';
import path from 'path';
import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';
import HoldItem from './holdItem.js';

interface ArchitectureBlock {
  name: string; // ブロック名
  position: {
    // 相対座標
    x: number;
    y: number;
    z: number;
  };
  facing?: string; // 向き（オプション）
}

interface Architecture {
  name: string;
  blocks: ArchitectureBlock[];
}

class BuildArchitecture extends InstantSkill {
  private holdItem: HoldItem;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'build-architecture';
    this.description =
      'placeBlockを複数回使用して指定された設計図を建築します。';
    this.params = [
      {
        name: 'architectureName',
        description: '建築する設計図の名前',
        type: 'string',
        required: true,
      },
      {
        name: 'placePosition',
        description: '建築する設計図の原点の座標',
        type: 'Vec3',
        required: true,
      },
    ];
    this.holdItem = new HoldItem(bot);
  }

  async runImpl(architectureName: string, placePosition: Vec3) {
    try {
      // 設計図のJSONファイルを読み込む
      const architectureData = await this.loadArchitectureData(
        architectureName
      );
      if (!architectureData) {
        return {
          success: false,
          result: `設計図 "${architectureName}" が見つかりませんでした。`,
        };
      }

      // ブロックの数を取得
      const totalBlocks = architectureData.blocks.length;
      let lastCheckResult = null;
      let retryCount = 0;
      while (retryCount < 3) {
        let placedBlocks = 0;
        let remainingBlocks = [...architectureData.blocks]; // 未設置ブロックのリスト
        let noProgressCount = 0; // 進捗がない試行回数
        let temporaryBlocks = []; // 仮置きしたブロックのリスト

        // 全ブロックを設置するか、進捗がなくなるまで繰り返す
        while (remainingBlocks.length > 0) {
          let madeProgress = false; // この反復で進捗があったか
          let newRemainingBlocks = []; // 次の反復に持ち越すブロック

          for (const block of remainingBlocks) {
            // ブロックの絶対座標を計算
            const blockPos = new Vec3(
              placePosition.x + block.position.x,
              placePosition.y + block.position.y,
              placePosition.z + block.position.z
            );

            // すでにブロックが設置されているか確認
            const existingBlock = this.bot.blockAt(blockPos);
            if (existingBlock && existingBlock.name !== 'air') {
              // 既存のブロックが目的のブロックと異なる場合は破壊
              if (!existingBlock.name.includes(block.name)) {
                try {
                  console.log(
                    `異なるブロック "${existingBlock.name}" を破壊します。期待値: "${block.name}"`
                  );
                  const toolIds = existingBlock.harvestTools
                    ? Object.keys(existingBlock.harvestTools).map(Number)
                    : [];
                  const hasTool = this.bot.inventory
                    .items()
                    .some((item) => toolIds.includes(item.type));
                  if (!hasTool && existingBlock.harvestTools !== undefined) {
                    return {
                      success: false,
                      result: `掘るためのツールがインベントリにありません。`,
                    };
                  }
                  const bestTool =
                    this.bot.pathfinder.bestHarvestTool(existingBlock);
                  if (bestTool) {
                    await this.holdItem.run(bestTool.name);
                  }
                  await this.bot.dig(existingBlock);
                  // 少し待機して連続操作によるエラーを防止
                  await new Promise((resolve) => setTimeout(resolve, 250));
                } catch (digError: any) {
                  console.error(`ブロック破壊中にエラー: ${digError.message}`);
                  newRemainingBlocks.push(block); // 後で再試行
                  continue;
                }
              } else {
                // すでに正しいブロックが設置されている場合はスキップ
                placedBlocks++;
                madeProgress = true;
                continue;
              }
            }

            // インベントリからブロックを検索
            const itemInInventory = this.bot.inventory
              .items()
              .find((item) => item.name.includes(block.name));

            if (!itemInInventory) {
              console.log(
                `ブロック "${block.name}" がインベントリにありません。`
              );
              // インベントリにないブロックの数をカウント
              const missingBlocks = newRemainingBlocks.filter(
                (b) => !this.bot.inventory.items().some((item) => item.name.includes(b.name))
              ).length;

              // すべての残りのブロックがインベントリにない場合は処理を終了
              if (missingBlocks === newRemainingBlocks.length) {
                return {
                  success: placedBlocks > 0,
                  result: `設計図 "${architectureName}" の建築を中断しました。${placedBlocks}/${totalBlocks} ブロックを設置しました。残りのブロックがインベントリにありません。`,
                };
              }
              newRemainingBlocks.push(block); // 後で再試行
              continue;
            }

            // ブロックを設置するための隣接ブロックを探す
            const referenceBlock = await this.findAdjacentBlock(blockPos);
            if (!referenceBlock) {
              console.log(
                `設置する隣接ブロックが見つかりません。足場を試みます。座標: (${blockPos.x}, ${blockPos.y}, ${blockPos.z})`
              );

              // 足場用のブロックを設置するための位置を計算（例: 1つ下）
              const scaffoldPos = blockPos.offset(0, -1, 0);

              // 足場ブロックの設置を試みる
              if (await this.placeScaffoldBlock(scaffoldPos)) {
                console.log(
                  `足場ブロックを設置しました。座標: (${scaffoldPos.x}, ${scaffoldPos.y}, ${scaffoldPos.z})`
                );
                // 足場ブロックを記録して後で再試行
                temporaryBlocks.push({
                  position: scaffoldPos.clone(),
                });
                madeProgress = true;
              }

              // 本来のブロックは次のイテレーションで設置を試みる
              newRemainingBlocks.push(block);
              continue;
            }

            try {
              // スロットを持ち替え
              await this.bot.equip(itemInInventory, 'hand');

              // ブロックを設置
              const placeBlock = this.bot.instantSkills.getSkill('place-block');
              if (!placeBlock)
                return {
                  success: false,
                  result: 'place-block スキルが見つかりません。',
                };
              const result = await placeBlock.run(
                block.name,
                blockPos,
                referenceBlock.position,
                false
              );
              if (result.success) {
                console.log(
                  `ブロック "${block.name}" を座標 (${blockPos.x}, ${blockPos.y}, ${blockPos.z}) に設置しました。`
                );
                placedBlocks++;
                madeProgress = true;
              } else {
                console.error(`ブロック設置に失敗しました: ${result.result}`);
                newRemainingBlocks.push(block); // 後で再試行
              }
              // 少し待機して連続設置によるエラーを防止
              await new Promise((resolve) => setTimeout(resolve, 250));
            } catch (blockError) {
              console.error(`ブロック設置中にエラー: ${blockError}`);
              newRemainingBlocks.push(block); // 後で再試行
            }
          }

          // 進捗がなかった場合はカウントアップ
          if (!madeProgress) {
            noProgressCount++;

            // 3回連続で進捗がなかった場合は中止
            if (noProgressCount >= 3) {
              const notPlacedCount = newRemainingBlocks.length;
              return {
                success: placedBlocks > 0,
                result: `設計図 "${architectureName}" の建築を中断しました。${placedBlocks}/${totalBlocks} ブロックを設置しました。残り ${notPlacedCount} ブロックは設置できませんでした。`,
              };
            }
          } else {
            // 進捗があった場合はカウントリセット
            noProgressCount = 0;
          }
        }

        // 仮置きした足場ブロックの撤去（オプション）
        // 足場撤去オプションを追加する場合はここに実装

        // 設計図通りに配置されているかチェック
        const checkResult = await this.checkArchitecturePlacement(
          architectureData,
          placePosition
        );
        lastCheckResult = checkResult;
        if (checkResult.incorrect === 0) {
          let resultMsg = `設計図 "${architectureName}" の建築を完了しました。全 ${totalBlocks} ブロックを設置しました。`;
          return {
            success: true,
            result: resultMsg,
          };
        } else {
          retryCount++;
          if (retryCount < 3) {
            console.log(
              `設計図と異なるブロックが${checkResult.incorrect}箇所ありました。再試行します（${retryCount}回目）`
            );
          }
        }
      }
      // 3回失敗した場合
      if (!lastCheckResult) {
        return {
          success: false,
          result: `設計図 "${architectureName}" の建築チェックに失敗しました。内部エラーです。`,
        };
      }
      let resultMsg = `設計図 "${architectureName}" の建築を完了しましたが、${lastCheckResult.incorrect
        } 箇所で設計図と異なるブロックがあります。\n${lastCheckResult.details
          .slice(0, 5)
          .join('\n')}${lastCheckResult.incorrect > 5 ? ' ...' : ''}`;
      return {
        success: false,
        result: resultMsg,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `建築中にエラーが発生しました: ${error.message}`,
      };
    }
  }

  // 足場ブロックを設置する
  private async placeScaffoldBlock(scaffoldPos: Vec3): Promise<boolean> {
    try {
      // 既存のブロックを確認
      const existingBlock = this.bot.blockAt(scaffoldPos);
      if (existingBlock && existingBlock.name !== 'air') {
        // すでにブロックがある場合は成功扱い
        return true;
      }

      // 足場用ブロック（土など簡単に入手できるもの）を検索
      const scaffoldOptions = ['dirt', 'cobblestone', 'stone'];
      let scaffoldItem = null;

      for (const option of scaffoldOptions) {
        scaffoldItem = this.bot.inventory
          .items()
          .find((item) => item.name.includes(option));
        if (scaffoldItem) break;
      }

      if (!scaffoldItem) {
        console.log('足場用ブロックがインベントリにありません。');
        return false;
      }

      // 足場ブロックを設置するための隣接ブロックを探す
      const scaffoldRefBlock = await this.findAdjacentBlock(scaffoldPos);
      if (!scaffoldRefBlock) {
        console.log(
          '足場用ブロックを設置するための隣接ブロックが見つかりません。'
        );
        return false;
      }

      // スロットを持ち替え
      await this.bot.equip(scaffoldItem, 'hand');

      // 足場ブロックを設置
      const placeBlock = this.bot.instantSkills.getSkill('place-block');
      if (!placeBlock) {
        console.error('place-block スキルが見つかりません。');
        return false;
      }

      const result = await placeBlock.run(
        scaffoldItem.name,
        scaffoldPos,
        scaffoldRefBlock.position,
        false
      );
      if (result.success) {
        console.log(
          `足場ブロック "${scaffoldItem.name}" を座標 (${scaffoldPos.x}, ${scaffoldPos.y}, ${scaffoldPos.z}) に設置しました。`
        );
        // 少し待機して連続設置によるエラーを防止
        await new Promise((resolve) => setTimeout(resolve, 250));
        return true;
      } else {
        console.error(`足場ブロック設置に失敗しました: ${result.result}`);
        return false;
      }
    } catch (error: any) {
      console.error(`足場ブロック設置中にエラー: ${error.message}`);
      return false;
    }
  }

  // 設計図データを読み込む
  private async loadArchitectureData(
    architectureName: string
  ): Promise<Architecture | null> {
    try {
      const filePath = path.join(
        process.cwd(),
        'saves',
        'minecraft',
        'architecture',
        `${architectureName}.json`
      );

      // ファイルが存在するか確認
      if (!fs.existsSync(filePath)) {
        return null;
      }

      // JSONファイルを読み込む
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(fileContent) as Architecture;
      return data;
    } catch (error) {
      console.error(`設計図データの読み込み中にエラー: ${error}`);
      return null;
    }
  }

  // ブロックを設置するための隣接ブロックを探す
  private async findAdjacentBlock(blockPos: Vec3) {
    // ブロックの六面を調べる
    const directions = [
      new Vec3(0, -1, 0), // 下
      new Vec3(0, 1, 0), // 上
      new Vec3(-1, 0, 0), // 西
      new Vec3(1, 0, 0), // 東
      new Vec3(0, 0, -1), // 北
      new Vec3(0, 0, 1), // 南
    ];

    for (const direction of directions) {
      const adjacentPos = blockPos.clone().add(direction);
      const block = this.bot.blockAt(adjacentPos);

      if (block && block.name !== 'air') {
        return block;
      }
    }

    return null;
  }

  // ブロックの設置面を決定する
  private getFaceVector(blockPos: Vec3, referencePos: Vec3): Vec3 {
    // 設置位置と参照ブロックの位置から設置面を計算
    const dx = blockPos.x - referencePos.x;
    const dy = blockPos.y - referencePos.y;
    const dz = blockPos.z - referencePos.z;

    // 最も大きな値を持つ軸を選択
    if (Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) >= Math.abs(dz)) {
      return new Vec3(Math.sign(dx), 0, 0);
    } else if (Math.abs(dy) >= Math.abs(dx) && Math.abs(dy) >= Math.abs(dz)) {
      return new Vec3(0, Math.sign(dy), 0);
    } else {
      return new Vec3(0, 0, Math.sign(dz));
    }
  }

  // 設計図通りに配置されているかチェック
  private async checkArchitecturePlacement(
    architectureData: Architecture,
    placePosition: Vec3
  ): Promise<{ correct: number; incorrect: number; details: string[] }> {
    let correct = 0;
    let incorrect = 0;
    let details: string[] = [];
    for (const block of architectureData.blocks) {
      const blockPos = new Vec3(
        placePosition.x + block.position.x,
        placePosition.y + block.position.y,
        placePosition.z + block.position.z
      );
      const existingBlock = this.bot.blockAt(blockPos);
      if (existingBlock && existingBlock.name.includes(block.name)) {
        correct++;
      } else {
        incorrect++;
        details.push(
          `(${blockPos.x},${blockPos.y},${blockPos.z}): 期待=${block.name
          }, 実際=${existingBlock ? existingBlock.name : '空気'}`
        );
      }
    }
    return { correct, incorrect, details };
  }
}

export default BuildArchitecture;

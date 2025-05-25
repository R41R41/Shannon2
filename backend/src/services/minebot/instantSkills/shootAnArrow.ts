import { CustomBot, InstantSkill } from '../types.js';
import HoldItem from './holdItem.js';
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';

class ShootAnArrow extends InstantSkill {
  private holdItem: HoldItem;
  private isLocked: boolean;
  private mcData: any;
  private searchDistance: number;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'shoot-an-arrow';
    this.description = '近くにある指定エンティティまたは指定座標、または指定した名前のブロックに弓を射撃します';
    this.params = [
      {
        name: 'entityName',
        type: 'string',
        description:
          '射撃するエンティティの名前を指定します。nullの場合は指定座標に射撃します。例: zombie, creeper, R41R41(ユーザー名)など',
        default: null,
      },
      {
        name: 'blockName',
        type: 'string',
        description:
          '射撃するブロックの名前を指定します。nullの場合は指定エンティティか指定座標に射撃します。例: targetなど',
        default: null,
      },
      {
        name: 'coordinate',
        type: 'Vec3',
        description:
          '射撃する座標を指定します。エンティティが指定されている場合はこの座標に最も近いエンティティに射撃します。',
        default: null,
      },
    ];
    this.mcData = minecraftData(this.bot.version);
    this.searchDistance = 64;
    this.holdItem = new HoldItem(this.bot);
    this.isLocked = false;
  }

  async getNearestEntity(
    entityName: string,
    coordinate: Vec3 | null,
    distance: number
  ) {
    const entities = Object.values(this.bot.entities).filter((entity) => {
      if (entity.name !== entityName) return false;
      if (coordinate && entity.position.distanceTo(coordinate) > distance)
        return false;
      return true;
    });
    if (entities.length === 0) return null;
    const sortedEntities = entities
      .map((entity) => {
        // coordinateがnullならbotの位置との距離でソート
        const dist = coordinate
          ? entity.position.distanceTo(coordinate)
          : entity.position.distanceTo(this.bot.entity.position);
        return { entity, distance: dist };
      })
      .sort((a, b) => a.distance - b.distance);
    return sortedEntities[0].entity;
  }

  // hawkEyeを使用して弓を発射する
  private async shootWithHawkEye(target: any): Promise<void> {
    console.log('hawkEyeでの射撃を開始します...');

    // hawkEyeでターゲットを狙って発射
    this.bot.hawkEye.oneShot(target, 'bow' as any);

    // 発射が完了するまで待機
    await new Promise((resolve) => {
      let shotsLeft = 2; // 2回のイベントを待機（弓を引く＋矢を放つ）

      const checkStatus = () => {
        shotsLeft--;
        if (shotsLeft <= 0) {
          this.bot.removeListener('physicsTick', checkStatus);
          resolve(undefined);
        }
      };

      // 一定時間後に解決する（タイムアウト）
      const timeout = setTimeout(() => {
        this.bot.removeListener('physicsTick', checkStatus);
        // 弓が引かれたままなら強制的に解除
        try {
          this.bot.deactivateItem();
        } catch (err) {
          // エラーは無視
        }
        resolve(undefined);
      }, 4000);

      // 物理ティックごとにステータスをチェック
      this.bot.on('physicsTick', checkStatus);
    });

    console.log('射撃完了');
  }

  async run(
    entityName: string | null,
    blockName: string | null,
    coordinate: Vec3 | null
  ) {
    console.log('shootAnArrow:', entityName, blockName, coordinate);
    try {
      if (entityName !== null) {
        const entities = await this.bot.utils.getNearestEntitiesByName(
          this.bot,
          entityName
        );
        if (entities.length === 0) {
          return {
            success: false,
            result: `エンティティ${entityName}は見つかりませんでした`,
          };
        }
        await this.holdItem.run('bow', false);
        if (!this.bot.hawkEye) {
          return {
            success: false,
            result: `hawkEyeが有効になっていません`,
          };
        }
        await this.shootWithHawkEye(entities[0]);
        return {
          success: true,
          result: `エンティティ${entityName}に射撃しました`,
        };
      } else if (coordinate !== null) {
        await this.holdItem.run('bow', false);

        // 座標を正しくターゲットとして構成
        const targetPos = new Vec3(coordinate.x, coordinate.y, coordinate.z);
        const target = {
          position: targetPos,
          isValid: true,
          velocity: { x: 0, y: 0, z: 0 },
          height: 1,
          width: 1,
          onGround: true,
        };
        await this.shootWithHawkEye(target);
        return {
          success: true,
          result: `座標${coordinate.x},${coordinate.y},${coordinate.z}に射撃しました`,
        };
      } else if (blockName !== null) {
        const Block = this.mcData.blocksByName[blockName];
        if (!Block) {
          return { success: false, result: `ブロック${blockName}はありません` };
        }
        const Blocks = this.bot.findBlocks({
          matching: Block.id,
          maxDistance: this.searchDistance,
          count: 1,
        });
        if (Blocks.length === 0) {
          return {
            success: false,
            result: `ブロック${blockName}は見つかりませんでした`,
          };
        }
        await this.holdItem.run('bow', false);
        const block = Blocks[0];
        const blockPos = new Vec3(block.x, block.y, block.z);
        const botPos = this.bot.entity.position;

        // ブロックの各面の中心座標を計算
        // 各面の位置とその面の1ブロック先の位置を計算
        const faces = [
          { pos: new Vec3(block.x + 0.5, block.y + 0.5, block.z), normal: new Vec3(0, 0, -1), checkPos: new Vec3(block.x, block.y, block.z - 1) }, // 北
          { pos: new Vec3(block.x + 0.5, block.y + 0.5, block.z + 1), normal: new Vec3(0, 0, 1), checkPos: new Vec3(block.x, block.y, block.z + 1) }, // 南
          { pos: new Vec3(block.x, block.y + 0.5, block.z + 0.5), normal: new Vec3(-1, 0, 0), checkPos: new Vec3(block.x - 1, block.y, block.z) }, // 西
          { pos: new Vec3(block.x + 1, block.y + 0.5, block.z + 0.5), normal: new Vec3(1, 0, 0), checkPos: new Vec3(block.x + 1, block.y, block.z) }, // 東
          { pos: new Vec3(block.x + 0.5, block.y, block.z + 0.5), normal: new Vec3(0, -1, 0), checkPos: new Vec3(block.x, block.y - 1, block.z) }, // 下
          { pos: new Vec3(block.x + 0.5, block.y + 1, block.z + 0.5), normal: new Vec3(0, 1, 0), checkPos: new Vec3(block.x, block.y + 1, block.z) }, // 上
        ];

        // 各面がブロックで覆われているかチェックし、見えている面のみをフィルタリング
        const visibleFaces = faces.filter(face => {
          const blockAtFace = this.bot.blockAt(face.checkPos);
          return !blockAtFace || blockAtFace.name === 'air';
        });

        if (visibleFaces.length === 0) {
          return {
            success: false,
            result: `ブロック${blockName}の全ての面が他のブロックで覆われています`,
          };
        }

        // botから最も見えている面を計算
        const botToBlock = blockPos.minus(botPos).normalize();
        const mostVisibleFace = visibleFaces.reduce((prev, curr) => {
          const dot1 = botToBlock.dot(prev.normal);
          const dot2 = botToBlock.dot(curr.normal);
          return dot1 > dot2 ? prev : curr;
        });

        const target = {
          position: mostVisibleFace.pos,
          isValid: false,
          velocity: { x: 0, y: 0, z: 0 },
          height: 0,
          width: 0,
          onGround: true,
        };
        await this.bot.lookAt(target.position);
        await this.shootWithHawkEye(target);
        return {
          success: true,
          result: `ブロック${blockName}に射撃しました`,
        }
      } else {
        return {
          success: false,
          result: `エンティティ名または座標が指定されていません`,
        };
      }
    } catch (error: any) {
      // エラー時に念のため右クリックを解除
      try {
        this.bot.deactivateItem();
      } catch (err) {
        // エラーは無視
      }
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default ShootAnArrow;

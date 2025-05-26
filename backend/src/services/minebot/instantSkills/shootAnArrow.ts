import { CustomBot, InstantSkill } from '../types.js';
import HoldItem from './holdItem.js';
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import { Block } from 'prismarine-block';

interface BlockInTrayect extends Block {
  intersect: Vec3;
}

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
  private async simplyShootWithHawkEye(yaw: number, pitch: number): Promise<void> {
    console.log('hawkEyeでの射撃を開始します...');

    // hawkEyeでターゲットを狙って発射
    this.bot.hawkEye.simplyShot(yaw, pitch);

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

      // 物理ティックごとにステータスをチェック
      this.bot.on('physicsTick', checkStatus);
    });

    console.log('射撃完了');
  }

  private async calculateYawAndPitch(target: Vec3): Promise<{ yaw: number, pitch: number }> {
    const botPos = this.bot.entity.position;
    const arrowPosition = botPos.plus(new Vec3(0, 1.55, 0));
    const dx = target.x - arrowPosition.x;
    const dy = target.y - arrowPosition.y;
    const dz = target.z - arrowPosition.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    const yaw = Math.atan2(-dx, -dz);
    const initialpitch = Math.atan2(dy, distance);
    const arrowInitialSpeed = 3;
    console.log('initialpitch', initialpitch);
    let pitch = initialpitch;
    let pitch_1 = null;
    let pitch_01 = null;
    let pitch_001 = null;
    while (true) {
      const arrowTrayectory = this.bot.hawkEye.calculateArrowTrayectory(arrowPosition, arrowInitialSpeed, pitch, yaw, 'bow' as any);
      const blockInTrayect = arrowTrayectory.blockInTrayect as BlockInTrayect;
      const diff_x = Math.abs(blockInTrayect.intersect.x - target.x);
      const diff_y = Math.abs(blockInTrayect.intersect.y - target.y);
      const diff_z = Math.abs(blockInTrayect.intersect.z - target.z);
      if (diff_x < 1 && diff_y < 1 && diff_z < 1) {
        console.log("pitch", pitch);
        console.log('blockInTrayect', blockInTrayect);
        pitch_1 = pitch;
      }
      if (diff_x < 0.1 && diff_y < 0.1 && diff_z < 0.1) {
        console.log("pitch", pitch);
        console.log('blockInTrayect', blockInTrayect);
        pitch_01 = pitch;
      }
      if (diff_x < 0.01 && diff_y < 0.01 && diff_z < 0.01) {
        pitch_001 = pitch;
        break;
      }
      pitch += 0.001;
      if (pitch > Math.PI / 2) {
        break;
      }
    }
    console.log('pitch_1', pitch_1);
    console.log('pitch_01', pitch_01);
    console.log('pitch_001', pitch_001);
    if (pitch_1) pitch = pitch_1;
    if (pitch_01) pitch = pitch_01;
    if (pitch_001) pitch = pitch_001;

    return { yaw, pitch };
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

      // 物理ティックごとにステータスをチェック
      this.bot.on('physicsTick', checkStatus);
    });

    console.log('射撃完了');
  }

  private getFaceCenter(blockPosition: Vec3): Vec3 {
    const botPos = this.bot.entity.position;
    const blockCenter = blockPosition.plus(new Vec3(0.5, 0.5, 0.5));
    const toBlock = blockCenter.minus(botPos);
    const abs = { x: Math.abs(toBlock.x), y: Math.abs(toBlock.y), z: Math.abs(toBlock.z) };
    let face: 'x' | 'y' | 'z';
    let sign: number;
    if (abs.x >= abs.y && abs.x >= abs.z) {
      face = 'x';
      sign = toBlock.x > 0 ? -1 : 1;
    } else if (abs.y >= abs.x && abs.y >= abs.z) {
      face = 'y';
      sign = toBlock.y > 0 ? -1 : 1;
    } else {
      face = 'z';
      sign = toBlock.z > 0 ? -1 : 1;
    }
    const faceCenter = blockPosition.clone();
    if (face === 'x') faceCenter.x += 0.5 * sign;
    if (face === 'y') faceCenter.y += 0.5 * sign;
    if (face === 'z') faceCenter.z += 0.5 * sign;
    return faceCenter;
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

        const blockPosition = new Vec3(block.x, block.y, block.z);
        const faceCenter = this.getFaceCenter(blockPosition);
        // 少しだけボット寄りにオフセット
        console.log('faceCenter', faceCenter);
        await this.bot.lookAt(faceCenter);
        await new Promise(resolve => setTimeout(resolve, 1000));
        const { yaw, pitch } = await this.calculateYawAndPitch(faceCenter);
        await this.simplyShootWithHawkEye(yaw, pitch);
        return {
          success: true,
          result: `ブロック${blockName}に射撃しました`,
        }
      } else if (coordinate !== null) {
        await this.holdItem.run('bow', false);

        // 座標を正しくターゲットとして構成
        const targetPos = new Vec3(coordinate.x, coordinate.y, coordinate.z);
        console.log('targetPos', targetPos);
        const faceCenter = this.getFaceCenter(targetPos);
        await this.bot.lookAt(faceCenter);
        await new Promise(resolve => setTimeout(resolve, 1000));
        const { yaw, pitch } = await this.calculateYawAndPitch(faceCenter);
        await this.simplyShootWithHawkEye(yaw, pitch);
        return {
          success: true,
          result: `座標${coordinate.x},${coordinate.y},${coordinate.z}に射撃しました`,
        };
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

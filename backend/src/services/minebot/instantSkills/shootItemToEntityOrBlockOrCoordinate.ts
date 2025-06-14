import minecraftData from 'minecraft-data';
import { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';
import HoldItem from './holdItem.js';

interface BlockInTrayect extends Block {
  intersect: Vec3;
}

class ShootItemToEntityOrBlockOrCoordinate extends InstantSkill {
  private holdItem: HoldItem;
  private isLocked: boolean;
  private mcData: any;
  private searchDistance: number;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'shoot-item-to-entity-or-block-or-coordinate';
    this.description = '近くにある指定エンティティまたは指定座標または指定した名前のブロックに指定したアイテムを射撃します。アイテムを手に持ったり、座標を特定することはこのスキル内で自動で行われます。';
    this.params = [
      {
        name: 'itemName',
        type: 'string',
        description:
          '射撃するアイテムの名前を指定します。nullの場合は弓を射撃します。例: snowball, ender_pearl, null',
        default: null,
      },
      {
        name: 'entityName',
        type: 'string',
        description:
          '射撃するエンティティの名前を指定します。指定されている場合は一番近くのそのエンティティに射撃します。例: zombie, creeper, R41R41(ユーザー名)など',
        default: null,
      },
      {
        name: 'blockName',
        type: 'string',
        description:
          '射撃するブロックの名前を指定します。指定されている場合は一番近くのそのブロックに射撃します。例: targetなど',
        default: null,
      },
      {
        name: 'coordinate',
        type: 'Vec3',
        description:
          '射撃する座標を指定します。nullでもエンティティ名かブロック名が指定されている場合はその位置に射撃します。',
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
  private async shootWithHawkEye(target: any, itemName: string | null): Promise<void> {
    console.log('hawkEyeでの射撃を開始します...');
    console.log('target', target);

    // hawkEyeでターゲットを狙って発射
    if (itemName === null) {
      itemName = 'bow';
    }
    this.bot.hawkEye.oneShot(target, itemName as any);

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

  public async shootToCoordinate(coordinate: Vec3, itemName: string | null): Promise<{ success: boolean, result: string }> {
    const targetPos = new Vec3(coordinate.x, coordinate.y, coordinate.z);
    const faceCenter = this.getFaceCenter(targetPos);
    const entityName = await this.summonInvisibleMarkerEntity(faceCenter);
    const entities = await this.bot.utils.getNearestEntitiesByName(this.bot, 'area_effect_cloud');
    const target = entities.find(e => e.name === "area_effect_cloud");
    if (target) {
      await this.shootWithHawkEye(target, itemName);
      await new Promise(resolve => setTimeout(resolve, 2000));
      await this.killEntityByName(entityName);
      return {
        success: true,
        result: `座標${coordinate}に射撃しました`,
      }
    } else {
      return {
        success: false,
        result: `ターゲット座標は見つかりませんでした`,
      };
    }
  }

  private getFaceCenter(blockPosition: Vec3): Vec3 {
    const botPos = this.bot.entity.position;
    const blockCenter = blockPosition.plus(new Vec3(0.5, 0.5, 0.5));
    const toBlock = blockCenter.minus(botPos);
    const abs = { x: Math.abs(toBlock.x), y: Math.abs(toBlock.y), z: Math.abs(toBlock.z) };
    console.log('abs', abs);
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
    const faceCenter = blockCenter.clone();
    console.log('blockCenter', blockCenter);
    console.log('face', face);
    if (face === 'x') faceCenter.x += 0.6 * sign;
    if (face === 'y') faceCenter.y += 0.6 * sign;
    if (face === 'z') faceCenter.z += 0.6 * sign;
    return faceCenter;
  }

  private async summonInvisibleMarkerEntity(pos: Vec3): Promise<string> {
    // 一意な名前をつける
    console.log('summonInvisibleMarkerEntity', pos);
    const name = `shoot_target_${Date.now()}`;
    const cmd = `/summon area_effect_cloud ${pos.x} ${pos.y} ${pos.z} {Radius:0.1,Duration:600,Invisible:1b,NoGravity:1b,Marker:1b,Tags:['${name}'],Particle:{type:'block',block_state:'minecraft:air'}}`;
    await this.bot.chat(cmd);
    // 少し待つ（サーバー反映待ち）
    await new Promise(resolve => setTimeout(resolve, 500));
    return name;
  }

  private async killEntityByName(name: string) {
    const cmd1 = `/tp @e[type=area_effect_cloud, tag=${name}] ~ ~1000 ~`;
    const cmd2 = `/kill @e[type=area_effect_cloud, tag=${name}]`;
    await this.bot.chat(cmd1);
    await this.bot.chat(cmd2);
  }

  async runImpl(
    itemName: string | null,
    entityName: string | null,
    blockName: string | null,
    coordinate: Vec3 | null
  ) {
    console.log('\x1b[32m%s\x1b[0m', `shootItemToEntityOrBlockOrCoordinate: ${itemName} ${entityName} ${blockName} ${coordinate}`);
    if (itemName == 'arrow' || itemName == 'bow') itemName = null;
    try {
      if (itemName !== null) {
        const item = this.bot.inventory.items().find((item) => item.name === itemName);
        if (item) {
          await this.holdItem.run(itemName, false);
        } else {
          return {
            success: false,
            result: `アイテム${itemName}は見つかりませんでした`,
          };
        }
      } else {
        await this.holdItem.run('bow', false);
      }
      if (!this.bot.hawkEye) {
        return {
          success: false,
          result: `hawkEyeが有効になっていません`,
        };
      }
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
        await this.shootWithHawkEye(entities[0], itemName);
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
        const block = this.bot.blockAt(Blocks[0]);
        if (!block) {
          return {
            success: false,
            result: `ブロック${blockName}は見つかりませんでした`,
          };
        }
        const blockPosition = new Vec3(block.position.x, block.position.y, block.position.z);
        const faceCenter = this.getFaceCenter(blockPosition);
        const entityName = await this.summonInvisibleMarkerEntity(faceCenter);
        const entities = await this.bot.utils.getNearestEntitiesByName(this.bot, 'area_effect_cloud');
        const target = entities.find(e => e.name === "area_effect_cloud");
        if (target) {
          await this.shootWithHawkEye(target, itemName);
          await new Promise(resolve => setTimeout(resolve, 2000));
          await this.killEntityByName(entityName);
          return {
            success: true,
            result: `ブロック${blockName}に射撃しました`,
          }
        } else {
          return {
            success: false,
            result: `エンティティ${entityName}は見つかりませんでした`,
          };
        }
      } else if (coordinate !== null) {
        await this.holdItem.run('bow', false);
        const targetPos = new Vec3(coordinate.x, coordinate.y, coordinate.z);
        const faceCenter = this.getFaceCenter(targetPos);
        const entityName = await this.summonInvisibleMarkerEntity(faceCenter);
        const entities = await this.bot.utils.getNearestEntitiesByName(this.bot, 'area_effect_cloud');
        const target = entities.find(e => e.name === "area_effect_cloud");
        if (target) {
          await this.shootWithHawkEye(target, itemName);
          await new Promise(resolve => setTimeout(resolve, 2000));
          await this.killEntityByName(entityName);
          return {
            success: true,
            result: `座標${coordinate}に射撃しました`,
          }
        } else {
          return {
            success: false,
            result: `ターゲット座標は見つかりませんでした`,
          };
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

export default ShootItemToEntityOrBlockOrCoordinate;

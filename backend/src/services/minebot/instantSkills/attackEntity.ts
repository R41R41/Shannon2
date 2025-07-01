import minecraftData from 'minecraft-data';
import pathfinder from 'mineflayer-pathfinder';
import { Entity } from 'prismarine-entity';
import { CustomBot, InstantSkill } from '../types.js';
import HoldItem from './holdItem.js';
const { goals } = pathfinder;

class AttackEntity extends InstantSkill {
  private entities: Entity[];
  private entities_length: number;
  private holdItem: HoldItem;
  private startDropItemCount: number;
  private isLocked: boolean;
  private mcData: any;
  private entityDropsMap: Record<string, string[]>;

  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'attack-entity';
    this.description =
      '近くにいる指定したエンティティに近づいて攻撃し、オプションでドロップアイテムを収集します。';
    this.params = [
      {
        name: 'entityName',
        type: 'string',
        description:
          '攻撃するエンティティの名前を指定します。例: zombie, creeper, R41R41(ユーザー名)など',
        required: true,
      },
      {
        name: 'collectDropItem',
        type: 'string',
        description:
          '収集するドロップアイテムの名前を指定します。nullの場合は収集しません。',
        default: null,
      },
      {
        name: 'targetAmount',
        type: 'number',
        description:
          '収集するドロップアイテムの目標数量。collectDropItemがnullの場合は必ず0を指定してください。',
        default: 1,
      },
    ];
    this.entities = [];
    this.entities_length = 0;
    this.holdItem = new HoldItem(this.bot);
    this.isLocked = false;
    this.mcData = minecraftData(this.bot.version);
    this.startDropItemCount = 0;
    // エンティティとドロップアイテムの対応表を初期化
    this.entityDropsMap = {
      zombie: ['rotten_flesh'],
      skeleton: ['bone', 'arrow'],
      spider: ['string', 'spider_eye'],
      creeper: ['gunpowder'],
      enderman: ['ender_pearl'],
      blaze: ['blaze_rod'],
      sheep: ['wool', 'mutton', 'raw_mutton'],
      chicken: ['feather', 'chicken', 'raw_chicken'],
      cow: ['leather', 'beef', 'raw_beef'],
      pig: ['porkchop', 'raw_porkchop'],
      zombie_pigman: ['gold_nugget', 'rotten_flesh', 'gold_ingot'],
      ghast: ['ghast_tear', 'gunpowder'],
      slime: ['slime_ball'],
      witch: [
        'glass_bottle',
        'glowstone_dust',
        'gunpowder',
        'redstone',
        'spider_eye',
        'sugar',
        'stick',
      ],
      iron_golem: ['iron_ingot', 'poppy'],
      bat: [],
      squid: ['ink_sac'],
      guardian: ['prismarine_shard', 'prismarine_crystals', 'raw_fish', 'fish'],
      silver_fish: [],
      rabbit: ['rabbit', 'rabbit_foot', 'rabbit_hide', 'raw_rabbit'],
      phantom: ['phantom_membrane'],
      wither_skeleton: ['wither_rose', 'wither_skull'],
      zombie_villager: ['rotten_flesh'],
      pillager: [
        'crossbow',
        'arrow',
        'gold_ingot',
        'emerald',
        'ghast_tear',
        'gunpowder',
        'redstone',
        'spider_eye',
        'sugar',
        'stick',
      ],
      zombified_piglin: ['rotten_flesh'],
    };
  }

  async runImpl(
    entityName: string,
    collectDropItem: string | null,
    targetAmount: number = 1
  ) {
    try {
      // collectDropItemが指定されている場合、エンティティとドロップアイテムの関連性を検証
      console.log('entityName', entityName);
      console.log('collectDropItem', collectDropItem);
      console.log('targetAmount', targetAmount);
      if (collectDropItem !== null) {
        const isValidDrop = await this.validateEntityDrops(
          entityName,
          collectDropItem
        );
        if (!isValidDrop) {
          return {
            success: false,
            result: `警告: ${entityName} からは通常 ${collectDropItem} はドロップしません。別のエンティティを選ぶか、別のドロップアイテムを指定してください。`,
          };
        }
      }
      // ドロップアイテムの収集なしの場合は1体だけ倒す
      if (collectDropItem === null) {
        return await this.attackSingleEntity(entityName);
      }
      // ドロップアイテム収集が必要な場合
      const inventoryBefore = this.bot.inventory
        .items()
        .filter(
          (i) =>
            i.name.includes(collectDropItem) ||
            i.displayName?.includes(collectDropItem)
        )
        .reduce((sum, i) => sum + i.count, 0);
      this.startDropItemCount = inventoryBefore;
      console.log(`startDropItemCount:${this.startDropItemCount}`);
      let collectedTotal = 0;
      let attempts = 0;
      const maxAttempts = 30; // 安全のため最大試行回数を設定
      this.status = true;
      while (
        collectedTotal < targetAmount &&
        attempts < maxAttempts &&
        this.status
      ) {
        attempts++;
        // エンティティを倒す
        console.log(
          `試行回数:${attempts} 収集したアイテム数:${collectedTotal}`
        );
        const attackResult = await this.attackSingleEntity(entityName);
        if (!attackResult.success) {
          attempts++;
          console.log(attackResult.result);
          continue;
        }
        // アイテムがドロップするまで待機
        await new Promise((resolve) => setTimeout(resolve, 1000));
        // 指定されたドロップアイテムを収集
        const collectResult = await this.collectDropItems(collectDropItem);
        collectedTotal += collectResult.collected;
        // 次のエンティティを探す前に短い待機
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (collectedTotal >= targetAmount) {
        return {
          success: true,
          result: `${entityName}を倒し、${collectDropItem}を${collectedTotal}個収集しました。`,
        };
      } else {
        return {
          success: true,
          result: `${attempts}回試行しましたが、${collectDropItem}は目標の${targetAmount}個には達せず${collectedTotal}個収集しました。`,
        };
      }
    } catch (error: any) {
      // エラーの詳細は出力せず、一般的なエラーメッセージを返す
      return { success: false, result: `処理中にエラーが発生しました。` };
    }
  }

  // エンティティとドロップアイテムの関連性を検証するメソッド
  async validateEntityDrops(
    entityName: string,
    dropItemName: string
  ): Promise<boolean> {
    try {
      // エンティティ名を正規化（先頭の部分を取得）
      const baseName = entityName.split('_')[0].toLowerCase();

      // エンティティ名に対応するドロップアイテムを取得
      const possibleDrops = this.entityDropsMap[baseName] || [];

      // ドロップアイテムが登録されていない場合はバリデーションをスキップ
      if (possibleDrops.length === 0) {
        return true;
      }

      // 指定されたドロップアイテム名が含まれているか確認
      // 部分一致で検索（例：'raw_porkchop'は'porkchop'を含む）
      return possibleDrops.some(
        (item) =>
          item.includes(dropItemName.toLowerCase()) ||
          dropItemName.toLowerCase().includes(item)
      );
    } catch (error) {
      console.error(`ドロップアイテム検証中にエラーが発生しました`);
      // エラー時は検証をスキップ
      return true;
    }
  }

  // 指定されたアイテムを収集する機能
  async collectDropItems(itemName: string): Promise<{ collected: number }> {
    try {
      console.log('アイテムを拾います');
      let totalCollected = 0;
      const startPos = this.bot.entity.position.clone();

      // 近くのドロップアイテムを取得
      const nearbyItems = Object.values(this.bot.entities).filter((entity) => {
        return (
          entity.type === 'object' &&
          entity.objectType === 'Item' &&
          entity.position.distanceTo(startPos) < 10
        );
      });
      for (const item of nearbyItems) {
        try {
          // アイテムの近くに移動
          const pos = item.position.clone();
          await this.bot.pathfinder.goto(
            new goals.GoalBlock(
              Math.floor(pos.x),
              Math.floor(pos.y),
              Math.floor(pos.z)
            )
          );
          // 少し待機してアイテムを拾う時間を与える
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (err) {
          continue;
        }
      }
      // 収集後のインベントリをチェック
      const inventoryAfter = this.bot.inventory
        .items()
        .filter(
          (i) => i.name.includes(itemName) || i.displayName?.includes(itemName)
        )
        .reduce((sum, i) => sum + i.count, 0);
      console.log(`inventoryAfter:${inventoryAfter}`);
      // アイテム数が増えていれば収集成功
      if (inventoryAfter > this.startDropItemCount) {
        totalCollected += inventoryAfter - this.startDropItemCount;
      }

      return { collected: totalCollected };
    } catch (error) {
      console.error(error);
      return { collected: 0 };
    }
  }

  // 単一のエンティティを倒す機能
  async attackSingleEntity(entityName: string) {
    try {
      this.entities = await this.bot.utils.getNearestEntitiesByName(
        this.bot,
        entityName
      );
      this.entities_length = this.entities.length;
      if (this.entities_length === 0) {
        return {
          success: false,
          result: `周囲に${entityName}が見つかりません。`,
        };
      }
      const entity = this.entities[0];
      await this.attackEntityOnce(entity.id);
      // エンティティが倒れるまで待機
      let waitCount = 0;
      const maxWait = 20; // 最大10秒待機
      while (waitCount < maxWait) {
        try {
          this.entities = await this.bot.utils.getNearestEntitiesByName(
            this.bot,
            entityName
          );
          if (
            this.entities.length === 0 ||
            this.entities.every((e) => e.id !== entity.id)
          ) {
            return { success: true, result: `${entityName}を倒しました。` };
          }
          if (waitCount % 4 === 0) {
            // 2秒ごとに攻撃
            await this.attackEntityOnce(entity.id);
          }
        } catch (error) { }
        await new Promise((resolve) => setTimeout(resolve, 500));
        waitCount++;
      }
      return { success: false, result: `${entityName}を倒せませんでした。` };
    } catch (error) {
      return {
        success: false,
        result: `${entityName}の攻撃中にエラーが発生しました。`,
      };
    }
  }

  async attackEntityOnce(entityId: number) {
    const entity = this.bot.entities[entityId];
    if (entity.name === 'creeper') {
      await this.attackCreeper(entityId);
    } else if (
      entity.name &&
      [
        'skeleton',
        'stray',
        'blaze',
        'ghast',
        'witch',
        'wither_skelton',
        'pillager',
      ].includes(entity.name)
    ) {
      await this.attackRangedEntityOnce(entityId);
    } else if (
      entity.name &&
      ['zombified_piglin', 'enderman'].includes(entity.name)
    ) {
      await this.attackNormalEntityOnce(entityId);
    } else if (
      entity.name &&
      [
        'cow',
        'sheep',
        'pig',
        'chicken',
        'rabbit',
        'horse',
        'llama',
        'dolphin',
        'fox',
        'panda',
        'wolf',
        'cat',
        'villager',
      ].includes(entity.name)
    ) {
      await this.attackFriendlyEntityOnce(entityId);
    } else {
      await this.attackNormalEntityOnce(entityId);
    }
  }

  async attackCreeper(entityId: number) {
    const entity = this.bot.entities[entityId];
    await this.bot.lookAt(entity.position.offset(0, entity.height * 0.85, 0));
    const distance = this.bot.entity.position.distanceTo(entity.position);
    const weaponName = await this.searchAndHoldWeapon(true);
    if (weaponName && weaponName.includes('bow')) {
      if (distance > 16) {
        this.bot.hawkEye.oneShot(entity, 'bow' as any);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else if (distance <= 5) {
        await this.attackNormalOnce(entityId, true);
      } else {
        await this.bot.utils.runFromEntities(this.bot, [entity], 16);
      }
    } else {
      await this.attackNormalOnce(entityId, true);
    }
  }

  async attackRangedEntityOnce(entityId: number) {
    const entity = this.bot.entities[entityId];
    await this.bot.lookAt(entity.position.offset(0, entity.height * 0.85, 0));
    const distance = this.bot.entity.position.distanceTo(entity.position);
    const weaponName = await this.searchAndHoldWeapon(true);
    if (weaponName && weaponName.includes('bow') && distance > 16) {
      this.bot.hawkEye.oneShot(
        entity,
        (weaponName.includes('crossbow') ? 'crossbow' : 'bow') as any
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } else {
      await this.searchAndHoldWeapon(false);
      await this.attackNormalOnce(entityId, false);
    }
  }

  /**
   * isBow === falseの場合はaxe > sword > bow > Nothingの順でツールを持っている場合に手に持つ。
   * isBow === trueの場合はbow > axe > sword > Nothingの順でツールを持っている場合に手に持つ。
   * @param {boolean} isBow
   * @returns {string}
   */
  async searchAndHoldWeapon(isBow: boolean) {
    const axe = this.bot.inventory
      .items()
      .find(
        (item) => item.name.includes('axe') && !item.name.includes('pickaxe')
      );
    const sword = this.bot.inventory
      .items()
      .find((item) => item.name.includes('sword'));
    const bow = this.bot.inventory
      .items()
      .find((item) => item.name.includes('bow'));
    const arrow = this.bot.inventory
      .items()
      .find((item) => item.name.includes('arrow'));
    const heldItem = await this.bot.utils.getHoldingItem.run('hand');
    if (isBow && bow && arrow) {
      if (!heldItem.result.includes('bow'))
        await this.holdItem.run(bow.name, false);
      return bow.name;
    } else if (isBow && axe) {
      if (!heldItem.result.includes('axe') || axe.name.includes('pickaxe'))
        await this.holdItem.run(axe.name, false);
      return axe.name;
    } else if (isBow && sword) {
      if (!heldItem.result.includes('sword'))
        await this.holdItem.run(sword.name, false);
      return sword.name;
    } else if (!isBow && axe) {
      if (!heldItem.result.includes('axe') || axe.name.includes('pickaxe'))
        await this.holdItem.run(axe.name, false);
      return axe.name;
    } else if (!isBow && sword) {
      if (!heldItem.result.includes('sword'))
        await this.holdItem.run(sword.name, false);
      return sword.name;
    }
    return null;
  }

  //通常の敵モブへの攻撃関数
  /**
   * @param {import('../types.js').Entity} entity
   * @param {string} toolName
   */
  async attackNormalEntityOnce(entityId: number) {
    const entity = this.bot.entities[entityId];
    console.log(entity.name);
    await this.bot.lookAt(entity.position.offset(0, entity.height * 0.85, 0));
    const distance = this.bot.entity.position.distanceTo(entity.position);
    const weaponName = await this.searchAndHoldWeapon(false);
    if (weaponName && weaponName.includes('bow')) {
      if (distance > 8) {
        this.bot.hawkEye.oneShot(
          entity,
          (weaponName.includes('crossbow') ? 'crossbow' : 'bow') as any
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else if (distance <= 5) {
        await this.attackNormalOnce(entityId, true);
      } else {
        await this.bot.utils.runFromEntities(this.bot, [entity], 8);
      }
    } else {
      await this.attackNormalOnce(entityId, true);
    }
  }

  //友好・中立モブへの攻撃関数
  /**
   * @param {import('../types.js').Entity} entity
   * @param {string} toolName
   */
  async attackFriendlyEntityOnce(entityId: number) {
    const entity = this.bot.entities[entityId];
    const weaponName = await this.searchAndHoldWeapon(false);
    if (weaponName && weaponName.includes('bow')) {
      this.bot.hawkEye.oneShot(
        entity,
        (weaponName.includes('crossbow') ? 'crossbow' : 'bow') as any
      );
    } else {
      await this.attackNormalOnce(entityId, false);
    }
  }

  async attackNormalOnce(entityId: number, isHostileApproaching: boolean) {
    const entity = this.bot.entities[entityId];
    const distance = this.bot.entity.position.distanceTo(entity.position);
    let runDistance = 1;
    let attackDistance = 3;
    let approachDistance = 4;
    if (isHostileApproaching) {
      // 敵対モブ用の設定
      runDistance = 3;
      attackDistance = 4;
      approachDistance = 8;
    } else {
      // 友好・中立モブ用の設定
      runDistance = 0.5; // より近くまで接近可能
      attackDistance = 1; // より近距離での攻撃
      approachDistance = 3; // より近くまで近づく
    }
    await this.bot.lookAt(entity.position.offset(0, entity.height * 0.85, 0));
    if (distance > approachDistance) {
      console.log('エンティティに近づきます　現在の距離:', distance);
      const result = await this.bot.utils.goalDistanceEntity.run(
        entityId,
        attackDistance
      );
      if (!result.success) {
        return;
      }
      const newDistance = this.bot.entity.position.distanceTo(entity.position);
      if (newDistance <= attackDistance + 0.5) {
        console.log('攻撃します');
        await this.bot.attack(entity);
      } else {
        console.log('近づきます');
        const result = await this.bot.utils.goalDistanceEntity.run(
          entityId,
          attackDistance - 0.5
        );
        if (!result.success) {
          return;
        }
        console.log('攻撃します');
        await this.bot.attack(entity);
      }
    } else if (distance <= runDistance && isHostileApproaching) {
      console.log('遠ざかります');
      const result = await this.bot.utils.goalDistanceEntity.run(entityId, -12);
      if (!result.success) {
        return;
      }
    } else {
      // 適切な距離にいるか確認
      if (distance <= attackDistance + 0.5) {
        console.log('攻撃します');
        await this.bot.attack(entity);
      } else {
        console.log('近づきます');
        const result = await this.bot.utils.goalDistanceEntity.run(
          entityId,
          attackDistance
        );
        if (!result.success) {
          return;
        }
        console.log('攻撃します');
        await this.bot.attack(entity);
      }
    }
  }
}

export default AttackEntity;

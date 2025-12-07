import pathfinder from 'mineflayer-pathfinder';
import { CustomBot, InstantSkill } from '../types.js';
import { setMovements } from '../utils/setMovements.js';
const { goals } = pathfinder;

/**
 * 原子的スキル: エンティティについていく
 * GoalFollowを使用してプレイヤーやモブを追従する
 */
class FollowEntity extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'follow-entity';
    this.description =
      'プレイヤーやモブについていきます。対象が移動すると追従します。';
    this.params = [
      {
        name: 'targetName',
        type: 'string',
        description:
          '追従対象の名前（プレイヤー名 or モブの種類。例: "Player123", "cow", "zombie"）',
        required: true,
      },
      {
        name: 'range',
        type: 'number',
        description: 'どのくらい近づくか（ブロック数、デフォルト: 2）',
        default: 2,
      },
      {
        name: 'duration',
        type: 'number',
        description:
          '追従時間（ミリ秒、デフォルト: 30000=30秒）。0で無制限（手動停止まで）',
        default: 30000,
      },
    ];
  }

  async runImpl(
    targetName: string,
    range: number = 2,
    duration: number = 30000
  ) {
    try {
      if (!targetName) {
        return {
          success: false,
          result: '追従対象の名前を指定してください',
        };
      }

      // エンティティを検索
      const entity = this.findEntity(targetName);

      if (!entity) {
        return {
          success: false,
          result: `"${targetName}"が見つかりません。近くにいることを確認してください`,
        };
      }

      // pathfinderの移動設定
      setMovements(
        this.bot,
        false, // allow1by1towers
        true, // allowSprinting
        true, // allowParkour
        true, // canOpenDoors
        false, // canDig: 追従中は掘らない
        true, // dontMineUnderFallingBlock
        10, // digCost: 高めに設定（掘りにくくする）
        false // allowFreeMotion
      );

      // GoalFollowを設定
      const goal = new goals.GoalFollow(entity, range);

      console.log(
        `👣 ${targetName}の追従を開始（範囲: ${range}ブロック、時間: ${duration}ms）`
      );

      // 追従開始
      this.bot.pathfinder.setGoal(goal, true); // dynamic=trueで対象が動いても追従

      if (duration > 0) {
        // 指定時間後に停止
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            this.bot.pathfinder.stop();
            resolve();
          }, duration);
        });

        return {
          success: true,
          result: `${targetName}を${duration / 1000}秒間追従しました`,
        };
      } else {
        // 無制限追従（即座に返す、stop-movementなどで停止）
        return {
          success: true,
          result: `${targetName}の追従を開始しました（停止するには"やめて"と言ってください）`,
        };
      }
    } catch (error: any) {
      // 追従を停止
      try {
        this.bot.pathfinder.stop();
      } catch {
        // 無視
      }

      return {
        success: false,
        result: `追従エラー: ${error.message}`,
      };
    }
  }

  /**
   * 名前でエンティティを検索
   */
  private findEntity(name: string): any | null {
    const lowerName = name.toLowerCase();

    // プレイヤーを検索
    const player = this.bot.players[name]?.entity;
    if (player) {
      return player;
    }

    // 部分一致でプレイヤーを検索
    for (const playerName of Object.keys(this.bot.players)) {
      if (playerName.toLowerCase().includes(lowerName)) {
        const p = this.bot.players[playerName]?.entity;
        if (p) return p;
      }
    }

    // エンティティ（モブなど）を検索
    const entities = Object.values(this.bot.entities) as any[];
    let closestEntity = null;
    let closestDistance = Infinity;

    for (const entity of entities) {
      if (!entity.position || entity === this.bot.entity) continue;

      // 名前が一致するか確認
      const entityName = entity.name || entity.username || '';
      if (entityName.toLowerCase().includes(lowerName)) {
        const distance = entity.position.distanceTo(this.bot.entity.position);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestEntity = entity;
        }
      }
    }

    return closestEntity;
  }
}

export default FollowEntity;

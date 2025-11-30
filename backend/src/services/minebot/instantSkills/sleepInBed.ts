import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: ベッドで寝る
 */
class SleepInBed extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'sleep-in-bed';
    this.description = 'ベッドで寝て夜をスキップします。';
    this.params = [
      {
        name: 'x',
        type: 'number',
        description: 'ベッドのX座標',
        required: true,
      },
      {
        name: 'y',
        type: 'number',
        description: 'ベッドのY座標',
        required: true,
      },
      {
        name: 'z',
        type: 'number',
        description: 'ベッドのZ座標',
        required: true,
      },
    ];
  }

  async runImpl(x: number, y: number, z: number) {
    try {
      // パラメータチェック
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return {
          success: false,
          result: '座標は有効な数値である必要があります',
        };
      }

      const { Vec3 } = require('vec3');
      const pos = new Vec3(x, y, z);
      const bed = this.bot.blockAt(pos);

      if (!bed) {
        return {
          success: false,
          result: `座標(${x}, ${y}, ${z})にブロックが見つかりません`,
        };
      }

      // ベッドかチェック
      if (!bed.name.includes('bed')) {
        return {
          success: false,
          result: `${bed.name}はベッドではありません`,
        };
      }

      // 時間チェック
      const timeOfDay = this.bot.time.timeOfDay;
      // 夜は12542～23459
      if (timeOfDay < 12542 || timeOfDay > 23459) {
        return {
          success: false,
          result: '夜または嵐の時にしか寝られません',
        };
      }

      // 距離チェック
      const distance = this.bot.entity.position.distanceTo(pos);
      if (distance > 4.5) {
        return {
          success: false,
          result: `ベッドが遠すぎます（距離: ${distance.toFixed(1)}m）`,
        };
      }

      // 敵が近くにいないかチェック
      const nearbyMobs = Object.values(this.bot.entities).filter((entity) => {
        if (!entity || !entity.position) return false;
        const dist = entity.position.distanceTo(this.bot.entity.position);
        if (dist > 8) return false;

        const hostileMobs = [
          'zombie',
          'skeleton',
          'creeper',
          'spider',
          'enderman',
          'witch',
          'slime',
          'phantom',
          'blaze',
          'ghast',
        ];

        const entityName = entity.name?.toLowerCase() || '';
        return hostileMobs.some((mob) => entityName.includes(mob));
      });

      if (nearbyMobs.length > 0) {
        return {
          success: false,
          result: `近くに敵がいるため寝られません（${
            nearbyMobs[0].name
          }が${nearbyMobs[0].position
            .distanceTo(this.bot.entity.position)
            .toFixed(1)}m先にいます）`,
        };
      }

      // ベッドで寝る
      await this.bot.sleep(bed);

      // 起床を待つ
      return new Promise<{ success: boolean; result: string }>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({
            success: false,
            result: '起床がタイムアウトしました',
          });
        }, 10000);

        const onWake = () => {
          clearTimeout(timeout);
          this.bot.removeListener('wake', onWake);
          resolve({
            success: true,
            result: 'ベッドで寝て朝になりました',
          });
        };

        this.bot.once('wake', onWake);
      });
    } catch (error: any) {
      // エラーメッセージを詳細化
      let errorDetail = error.message;
      if (error.message.includes('too far')) {
        errorDetail = 'ベッドが遠すぎます';
      } else if (error.message.includes('monsters')) {
        errorDetail = '近くに敵がいます';
      } else if (error.message.includes('not night')) {
        errorDetail = '夜ではありません';
      } else if (error.message.includes('occupied')) {
        errorDetail = 'ベッドは使用中です';
      }

      return {
        success: false,
        result: `就寝エラー: ${errorDetail}`,
      };
    }
  }
}

export default SleepInBed;

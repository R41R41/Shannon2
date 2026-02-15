import { ConstantSkill, CustomBot } from '../types.js';

/**
 * 自動浮上スキル
 * 水中で酸素が半分以下になったら自動で水面に浮上する
 */
class AutoSwim extends ConstantSkill {
  private isSwimmingUp: boolean = false;

  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-swim';
    this.description = '水中で酸素が減ったら自動で浮上する（溺死防止）';
    this.interval = 100;  // 100msごとにチェック（高速反応）
    this.status = true;   // デフォルトでON
    this.priority = 10;   // 最高優先度
    this.containMovement = true;
    this.isCritical = true; // InstantSkill実行中でも動作する（生存スキル）
  }

  async runImpl() {
    try {
      // auto-followがアクティブな場合はスキップ（AutoFollowのswim()が酸素管理も行う）
      const autoFollow = this.bot.constantSkills.getSkill('auto-follow');
      if (autoFollow && autoFollow.status && autoFollow.isLocked) {
        // AutoFollowが水中移動中なので、そちらに任せる
        if (this.isSwimmingUp) {
          this.isSwimmingUp = false;
          this.bot.setControlState('jump', false);
        }
        return;
      }

      const oxygen = this.bot.oxygenLevel ?? 20;
      const isInWater = (this.bot.entity as any)?.isInWater || false;

      // 水中かつ酸素が半分以下（10未満）→ 浮上開始
      if (isInWater && oxygen < 10 && !this.isSwimmingUp) {
        console.log(`\x1b[36m🏊 自動浮上開始！酸素: ${oxygen}/20\x1b[0m`);
        this.isSwimmingUp = true;
      }

      // 浮上中は酸素が完全回復（20）するまで継続
      if (this.isSwimmingUp) {
        if (oxygen >= 20) {
          // 完全回復したら停止
          console.log(`\x1b[32m🏊 浮上完了！酸素完全回復: 20/20\x1b[0m`);
          this.isSwimmingUp = false;
          this.bot.setControlState('jump', false);
        } else {
          // まだ回復してない → 浮上継続
          this.bot.setControlState('jump', true);

          // 上を向く
          const currentPos = this.bot.entity.position;
          await this.bot.lookAt(currentPos.offset(0, 10, 0));
        }
      }
    } catch (error) {
      console.log('autoSwim error', error);
    }
  }
}

export default AutoSwim;

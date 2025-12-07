import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 盾でガード（ブロック）のON/OFF
 */
class SetShield extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'set-shield';
    this.description = '盾でガード（ブロック）のON/OFFを切り替えます。';
    this.params = [
      {
        name: 'enabled',
        type: 'boolean',
        description: 'true: ガードON, false: ガードOFF',
        required: true,
      },
    ];
  }

  async runImpl(enabled: boolean) {
    try {
      if (typeof enabled !== 'boolean') {
        return {
          success: false,
          result: 'enabledパラメータはtrue/falseで指定してください',
        };
      }

      // 盾を持っているかチェック
      const heldItem = this.bot.heldItem;
      const offhandItem =
        this.bot.inventory.slots[this.bot.getEquipmentDestSlot('off-hand')];

      const hasShield =
        (heldItem && heldItem.name === 'shield') ||
        (offhandItem && offhandItem.name === 'shield');

      if (enabled && !hasShield) {
        return {
          success: false,
          result: '盾を持っていないため、ガードできません',
        };
      }

      this.bot.activateItem(); // 盾の使用

      return {
        success: true,
        result: enabled
          ? '盾でガードを開始しました'
          : '盾でのガードを解除しました',
      };
    } catch (error: any) {
      return {
        success: false,
        result: `シールド切り替えエラー: ${error.message}`,
      };
    }
  }
}

export default SetShield;

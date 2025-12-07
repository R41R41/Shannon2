import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: ボットの状態を一括取得
 */
class GetBotStatus extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'get-bot-status';
    this.description =
      'ボットの全状態（体力、空腹度、位置、装備、インベントリ概要）を一度に取得します。';
    this.params = [];
  }

  async runImpl() {
    try {
      // 体力・空腹度
      const health = this.bot.health;
      const food = this.bot.food;
      const maxHealth = 20;
      const maxFood = 20;

      const healthPercent = Math.round((health / maxHealth) * 100);
      const foodPercent = Math.round((food / maxFood) * 100);

      let healthStatus = '';
      if (healthPercent >= 80) healthStatus = '良好';
      else if (healthPercent >= 50) healthStatus = '注意';
      else if (healthPercent >= 20) healthStatus = '危険';
      else healthStatus = '瀕死';

      let foodStatus = '';
      if (foodPercent >= 80) foodStatus = '満腹';
      else if (foodPercent >= 50) foodStatus = '通常';
      else if (foodPercent >= 20) foodStatus = '空腹';
      else foodStatus = '飢餓';

      // 位置
      const pos = this.bot.entity.position;
      const yaw = Math.round((this.bot.entity.yaw * 180) / Math.PI);
      const pitch = Math.round((this.bot.entity.pitch * 180) / Math.PI);

      // 装備
      const equipment: Record<string, string> = {};
      const slots = ['hand', 'head', 'torso', 'legs', 'feet', 'off-hand'];

      for (const slot of slots) {
        const item = (this.bot as any).inventory.slots[
          this.bot.getEquipmentDestSlot(slot as any)
        ];
        equipment[slot] = item ? item.name : 'なし';
      }

      // インベントリ概要（主要アイテムのみ）
      const items = this.bot.inventory.items();
      const itemSummary: Record<string, number> = {};

      for (const item of items) {
        if (itemSummary[item.name]) {
          itemSummary[item.name] += item.count;
        } else {
          itemSummary[item.name] = item.count;
        }
      }

      // 主要アイテムのみ表示（上位5個）
      const topItems = Object.entries(itemSummary)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => `${name} x${count}`)
        .join(', ');

      const totalItems = items.length;
      const emptySlots = 36 - totalItems;

      // 結果をまとめる
      const result = [
        `【体力】${health}/${maxHealth} (${healthPercent}%) [${healthStatus}]`,
        `【空腹度】${food}/${maxFood} (${foodPercent}%) [${foodStatus}]`,
        `【位置】(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(
          1
        )})`,
        `【向き】Yaw: ${yaw}°, Pitch: ${pitch}°`,
        `【手持ち】${equipment.hand}`,
        `【防具】頭: ${equipment.head}, 胴: ${equipment.torso}, 脚: ${equipment.legs}, 足: ${equipment.feet}`,
        `【オフハンド】${equipment['off-hand']}`,
        `【主要アイテム】${topItems || 'なし'}`,
        `【インベントリ】使用中: ${totalItems}/36, 空き: ${emptySlots}`,
      ].join('\n');

      return {
        success: true,
        result,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `状態取得エラー: ${error.message}`,
      };
    }
  }
}

export default GetBotStatus;

import { ConstantSkill, CustomBot } from '../types.js';

/**
 * 自動食事スキル
 * 体力または満腹度が低い時に自動で食べ物を食べる
 */
class AutoEat extends ConstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-eat';
    this.description = '体力または満腹度が低い時に自動で食べ物を食べます';
    this.interval = 1000; // 1秒ごとにチェック
    this.isLocked = false;
    this.status = false;
    this.priority = 5;
  }

  async runImpl() {
    // 既に食べている場合はスキップ
    if (this.bot.pathfinder.isMoving()) return;

    // 体力または満腹度が低い場合に食べる
    const health = this.bot.health;
    const food = this.bot.food;

    // 満腹度が15以下、または体力が18未満（ダメージ後の回復促進）で食べ物がある場合
    // Minecraftでは満腹度が18以上で自然回復するため、HPが減っていたら積極的に食べる
    if (food < 15 || (health < 18 && food < 20)) {
      // 食べられるアイテムを探す（mineflayer-auto-eatの情報を使用）
      const foodItems = this.bot.inventory
        .items()
        .filter((item) => {
          const foodData = (this.bot as any).autoEat?.foodData?.[item.name];
          return foodData && foodData.foodPoints > 0;
        })
        .sort((a, b) => {
          const aFood =
            (this.bot as any).autoEat?.foodData?.[a.name]?.foodPoints || 0;
          const bFood =
            (this.bot as any).autoEat?.foodData?.[b.name]?.foodPoints || 0;
          return bFood - aFood;
        });

      if (foodItems.length === 0) return;

      try {
        // 最も満腹度が高い食べ物を選択
        const foodItem = foodItems[0];

        // 既に手に持っている場合
        if (this.bot.heldItem?.name === foodItem.name) {
          await this.bot.consume();
          console.log(`\x1b[32m✓ ${foodItem.name}を食べました\x1b[0m`);
          return;
        }

        // 手に持つ
        await this.bot.equip(foodItem, 'hand');

        // 食べる
        await this.bot.consume();
        console.log(`\x1b[32m✓ ${foodItem.name}を食べました\x1b[0m`);
      } catch (error) {
        // エラーは無視（次回リトライ）
        console.log(
          `\x1b[33m⚠ 食事に失敗: ${
            error instanceof Error ? error.message : '不明なエラー'
          }\x1b[0m`
        );
      }
    }
  }
}

export default AutoEat;

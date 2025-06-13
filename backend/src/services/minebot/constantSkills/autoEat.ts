import EatFood from '../instantSkills/eatFood.js';
import { ConstantSkill, CustomBot } from '../types.js';

class AutoEat extends ConstantSkill {
  private eatFood: EatFood;
  private bannedFood: string[];
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-eat';
    this.description = '自動で食べる';
    this.isLocked = false;
    this.priority = 11;
    this.eatFood = new EatFood(this.bot);
    this.status = true;
    this.bannedFood = [
      this.bot.registry.foodsByName['pufferfish'].name,
      this.bot.registry.foodsByName['spider_eye'].name,
      this.bot.registry.foodsByName['poisonous_potato'].name,
      this.bot.registry.foodsByName['rotten_flesh'].name,
      this.bot.registry.foodsByName['chorus_fruit'].name,
      this.bot.registry.foodsByName['chicken'].name,
      this.bot.registry.foodsByName['suspicious_stew'].name,
      this.bot.registry.foodsByName['golden_apple'].name,
    ];
  }

  async runImpl() {
    if (this.bot.food < 20) {
      console.log('food is not enough');
      const food = this.bot.registry.foodsByName;
      const bestChoices = this.bot.inventory
        .items()
        .filter((item) => item.name in food)
        .filter((item) => !this.bannedFood.includes(item.name));
      const foodItem = bestChoices[0];
      if (foodItem) {
        await this.eatFood.run(foodItem.name);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }
}

export default AutoEat;

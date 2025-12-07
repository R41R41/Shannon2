import { Entity } from 'prismarine-entity';
import { ConstantSkill, CustomBot } from '../types.js';

class AutoFollow extends ConstantSkill {
  private lastStatus: boolean = false;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-follow';
    this.description = '自動で近くのプレイヤーを追尾する';
    this.isLocked = false;
    this.status = false;
    this.priority = 8;
    this.containMovement = true;
  }

  async runImpl(entityName: string) {
    try {
      while (this.status) {
        let entities = await this.bot.utils.getNearestEntitiesByName(
          this.bot,
          entityName
        );
        if (entities.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
        const entity = entities[0];
        this.bot.pathfinder.setGoal(null);
        this.bot.setControlState('sprint', false);
        this.bot.setControlState('forward', false);
        this.bot.setControlState('jump', false);
        this.bot.setControlState('sneak', false);
        if (this.bot.isInWater) {
          await this.swim(entity);
        } else {
          await this.bot.utils.goalFollow.run(entity, 1.5);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      this.bot.pathfinder.setGoal(null);
    } catch (error: any) {
      console.error('追尾ループ中にエラー:', error);
    }
  }

  async swim(entity: Entity | null) {
    if (entity !== null) {
      await this.bot.lookAt(entity.position, true);
    }
    this.bot.setControlState('sprint', true);
    this.bot.setControlState('forward', true);
    const frontBlock = this.bot.utils.getFrontBlock(this.bot, 1);
    const aboveBlock = this.bot.world.getBlock(
      this.bot.entity.position.offset(0, 2, 0)
    );
    const aboveAboveBlock = this.bot.world.getBlock(
      this.bot.entity.position.offset(0, 3, 0)
    );
    const belowBlock = this.bot.world.getBlock(
      this.bot.entity.position.offset(0, -1, 0)
    );

    if (this.bot.oxygenLevel < 5) {
      // 酸素レベルが低いなら、上に進む
      this.bot.setControlState('jump', true);
      this.bot.setControlState('sneak', false);
    } else if (
      frontBlock &&
      frontBlock.name !== 'water' &&
      frontBlock.name !== 'air'
    ) {
      // 前方に水がないなら、上に進む
      this.bot.setControlState('jump', true);
      this.bot.setControlState('sneak', false);
    } else if (
      aboveBlock &&
      aboveBlock.name !== 'water' &&
      belowBlock &&
      belowBlock.name == 'water'
    ) {
      // 泳げる深さがあって上方に水がないなら、下に進む
      this.bot.setControlState('jump', false);
      this.bot.setControlState('sneak', true);
    } else if (
      aboveAboveBlock &&
      aboveAboveBlock.name !== 'water' &&
      belowBlock &&
      belowBlock.name == 'water'
    ) {
      // 上に上に水があるなら、前に進む
      this.bot.setControlState('jump', false);
      this.bot.setControlState('sneak', false);
    } else if (
      entity !== null &&
      this.bot.entity.position.y < entity.position.y
    ) {
      // エンティティより下にいるなら、上に進む
      this.bot.setControlState('jump', true);
      this.bot.setControlState('sneak', false);
    }
  }
}

export default AutoFollow;

import pkg from 'mineflayer-pathfinder';
import { Entity } from 'prismarine-entity';
import { CustomBot, ResponseType } from '../types.js';
const { goals } = pkg;

export class GoalFollow {
  bot: CustomBot;
  constructor(bot: CustomBot) {
    this.bot = bot;
  }
  async run(entity: Entity, distance: number): Promise<ResponseType> {
    try {
      if (!entity || !entity.position) {
        console.error('エンティティの位置情報が取得できません:', entity); // デバッグ情報を追加
        return {
          success: false,
          result: 'エンティティの位置情報が取得できません',
        };
      }
      const goal = new goals.GoalFollow(entity, distance);
      await this.bot.pathfinder.setGoal(goal, true);
      return { success: true, result: 'ゴールに到達しました' };
    } catch (error) {
      console.error('Error in run:', error);
      return { success: false, result: 'ゴールに到達できませんでした' };
    }
  }
}

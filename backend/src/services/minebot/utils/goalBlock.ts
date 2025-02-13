import pkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { CustomBot, ResponseType } from '../types.js';
const { goals } = pkg;

export class GoalBlock {
  bot: CustomBot;
  constructor(bot: CustomBot) {
    this.bot = bot;
  }
  async run(position: Vec3): Promise<ResponseType> {
    try {
      await this.bot.pathfinder.goto(
        new goals.GoalBlock(position.x, position.y, position.z)
      );
      return { success: true, result: 'ゴールに到達しました' };
    } catch (error) {
      console.error('Error in run:', error);
      return { success: false, result: 'ゴールに到達できませんでした' };
    }
  }
  async goToNear(position: Vec3, distance: number): Promise<ResponseType> {
    try {
      await this.bot.pathfinder.goto(
        new goals.GoalNear(position.x, position.y, position.z, distance)
      );
      return { success: true, result: 'ゴールに到達しました' };
    } catch (error) {
      console.error('Error in goToNear:', error);
      return { success: false, result: 'ゴールに到達できませんでした' };
    }
  }
}

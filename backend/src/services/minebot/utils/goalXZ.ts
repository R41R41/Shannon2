import pkg from 'mineflayer-pathfinder';
import { CustomBot, ResponseType } from '../types.js';
const { goals } = pkg;

export class GoalXZ {
  bot: CustomBot;
  constructor(bot: CustomBot) {
    this.bot = bot;
  }

  async run(x: number, z: number): Promise<ResponseType> {
    try {
      if (!x || !z) {
        console.error('x, zの位置情報が取得できません:', x, z); // デバッグ情報を追加
        return { success: false, result: 'x, zの位置情報が取得できません' };
      }
      await this.bot.pathfinder.goto(new goals.GoalXZ(x, z));
      return { success: true, result: 'ゴールに到達しました' };
    } catch (error) {
      console.error('Error in run:', error);
      return { success: false, result: 'ゴールに到達できませんでした' };
    }
  }
}

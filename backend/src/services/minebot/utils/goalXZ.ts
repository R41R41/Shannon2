import pkg from 'mineflayer-pathfinder';
import { createLogger } from '../../../utils/logger.js';
import { CustomBot, ResponseType } from '../types.js';
const { goals } = pkg;

const log = createLogger('Minebot:Goal');

export class GoalXZ {
  bot: CustomBot;
  constructor(bot: CustomBot) {
    this.bot = bot;
  }

  async run(x: number, z: number): Promise<ResponseType> {
    try {
      if (!x || !z) {
        log.debug(`x, zの位置情報が取得できません: x=${x} z=${z}`);
        return { success: false, result: 'x, zの位置情報が取得できません' };
      }
      await this.bot.pathfinder.goto(new goals.GoalXZ(x, z));
      return { success: true, result: 'ゴールに到達しました' };
    } catch (error) {
      log.error('Error in run', error);
      return { success: false, result: 'ゴールに到達できませんでした' };
    }
  }
}

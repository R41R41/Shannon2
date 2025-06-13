import SleepInBed from '../instantSkills/sleepInBed.js';
import { ConstantSkill, CustomBot } from '../types.js';

class AutoSleep extends ConstantSkill {
  private sleepInBed: SleepInBed;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-sleep';
    this.description = '夜になったら自動で眠り、朝になったら自動で起きます';
    this.interval = 1000;
    this.isLocked = false;
    this.priority = 4;
    this.sleepInBed = new SleepInBed(this.bot);
    this.status = true;
    this.containMovement = true;
  }

  async runImpl() {
    if (this.isLocked) {
      return;
    }

    // 夜の時間帯 (12000-23000)
    const isNightTime =
      this.bot.time.timeOfDay >= 12500 && this.bot.time.timeOfDay <= 23500;

    // 朝の時間帯 (0-1000)
    const isMorningTime =
      this.bot.time.timeOfDay >= 0 && this.bot.time.timeOfDay <= 1000;

    // 既に寝ている場合で朝になったら起きる
    if (this.bot.isSleeping && isMorningTime) {
      this.lock();
      try {
        const result = await this.sleepInBed.run(true);
        console.log(result);
      } catch (error: any) {
        console.error(error);
      }
      this.unlock();
      return;
    }

    // 既に寝ている場合は何もしない
    if (this.bot.isSleeping) {
      return;
    }

    // 夜になったら寝る
    if (isNightTime) {
      this.lock();
      try {
        const result = await this.sleepInBed.run();
        console.log(result);
      } catch (error: any) {
        console.error(error);
      }
      this.unlock();
    }
  }
}

export default AutoSleep;

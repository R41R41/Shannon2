import { CustomBot, InstantSkill } from '../types.js';

/**
 * 原子的スキル: 時間と天候を確認
 */
class GetTimeAndWeather extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'get-time-and-weather';
    this.description = 'ゲーム内の時間と天候を確認します。';
    this.params = [];
  }

  async runImpl() {
    try {
      const timeOfDay = this.bot.time.timeOfDay;
      const age = this.bot.time.age;
      const isRaining = this.bot.isRaining;
      const thunderState = this.bot.thunderState;

      // 時刻を計算（0-24000）
      const hours = Math.floor(timeOfDay / 1000) + 6; // 0時を6000として計算
      const minutes = Math.floor(((timeOfDay % 1000) / 1000) * 60);
      const displayHours = hours >= 24 ? hours - 24 : hours;

      let timeDescription = '';
      if (timeOfDay < 450 || timeOfDay > 23850) {
        timeDescription = '夜明け前';
      } else if (timeOfDay < 1000) {
        timeDescription = '朝';
      } else if (timeOfDay < 6000) {
        timeDescription = '昼';
      } else if (timeOfDay < 12000) {
        timeDescription = '夕方';
      } else if (timeOfDay < 13000) {
        timeDescription = '夜';
      } else {
        timeDescription = '深夜';
      }

      let weatherDescription = '晴れ';
      if (thunderState > 0) {
        weatherDescription = '雷雨';
      } else if (isRaining) {
        weatherDescription = '雨';
      }

      return {
        success: true,
        result: `時刻: ${displayHours}:${minutes
          .toString()
          .padStart(2, '0')} (${timeDescription}), 天候: ${weatherDescription}`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `取得エラー: ${error.message}`,
      };
    }
  }
}

export default GetTimeAndWeather;

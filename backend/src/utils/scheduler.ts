import { CronJob } from 'cron';
import { TwitterClient } from '../services/twitter/client.js';

export class TwitterScheduler {
  private client: TwitterClient;
  private job: CronJob;

  constructor() {
    this.client = new TwitterClient();
    this.job = new CronJob('0 */4 * * *', () => {
      this.scheduledTweet();
    });
  }

  start() {
    this.job.start();
  }

  private async scheduledTweet() {
    // 定期ツイートのロジック
  }
}
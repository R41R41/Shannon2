import { TwitterClientInput } from '@shannon/common';
import { TwitterApi } from 'twitter-api-v2';
import { BaseClient } from '../common/BaseClient.js';
import { EventBus } from '../eventBus.js';

export class TwitterClient extends BaseClient {
  private client: TwitterApi;
  private myUserId: string;
  public isTest: boolean = false;

  private static instance: TwitterClient;

  public static getInstance(eventBus: EventBus, isTest: boolean = false) {
    if (!TwitterClient.instance) {
      TwitterClient.instance = new TwitterClient('twitter', eventBus, isTest);
    }
    TwitterClient.instance.isTest = isTest;
    return TwitterClient.instance;
  }

  private constructor(
    serviceName: 'twitter',
    eventBus: EventBus,
    isTest: boolean
  ) {
    super(serviceName, eventBus);
    const apiKey = isTest
      ? process.env.TWITTER_API_KEY_TEST
      : process.env.TWITTER_API_KEY;
    const apiKeySecret = isTest
      ? process.env.TWITTER_API_KEY_SECRET_TEST
      : process.env.TWITTER_API_KEY_SECRET;
    const accessToken = isTest
      ? process.env.TWITTER_ACCESS_TOKEN_TEST
      : process.env.TWITTER_ACCESS_TOKEN;
    const accessTokenSecret = isTest
      ? process.env.TWITTER_ACCESS_TOKEN_SECRET_TEST
      : process.env.TWITTER_ACCESS_TOKEN_SECRET;

    if (!apiKey || !apiKeySecret || !accessToken || !accessTokenSecret) {
      throw new Error('Twitter APIの認証情報が設定されていません');
    }

    this.myUserId = isTest
      ? process.env.TWITTER_USER_ID_TEST || ''
      : process.env.TWITTER_USER_ID || '';

    this.client = new TwitterApi({
      appKey: apiKey,
      appSecret: apiKeySecret,
      accessToken: accessToken,
      accessSecret: accessTokenSecret,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.eventBus.subscribe('twitter:status', async (event) => {
      console.log('twitter:status', event);
      const { serviceCommand } = event.data as TwitterClientInput;
      if (serviceCommand === 'start') {
        await this.start();
      } else if (serviceCommand === 'stop') {
        await this.stop();
      } else if (serviceCommand === 'status') {
        this.eventBus.publish({
          type: 'web:status',
          memoryZone: 'web',
          data: {
            service: 'twitter',
            status: this.status,
          },
        });
      }
    });
    if (this.status !== 'running') return;
    this.eventBus.subscribe('twitter:post_scheduled_message', async (event) => {
      const { text } = event.data as TwitterClientInput;
      try {
        if (text) {
          await this.postTweet(text);
        }
      } catch (error) {
        console.error('Twitter post error:', error);
      }
    });
    this.eventBus.subscribe('twitter:post_message', async (event) => {
      const { replyId, text } = event.data as TwitterClientInput;
      try {
        if (replyId && text) {
          await this.replyTweet(replyId, text);
        } else {
          await this.postTweet(text);
        }
      } catch (error) {
        console.error(`\x1b[31mTwitter post error: ${error}\x1b[0m`);
      }
    });
  }

  private async postTweet(content: string) {
    try {
      const response = await this.client.v2.tweet(content);
      console.log(
        `\x1b[32mTweet posted successfully ${response.data.id}\x1b[0m`
      );
    } catch (error: any) {
      console.error(`\x1b[31mTweet error: ${error.message}\x1b[0m`);
      throw error;
    }
  }

  /**
   * 自分のツイートを取得する
   * @returns ツイートIDの配列
   */
  private async getMyTweets(): Promise<string[]> {
    try {
      if (!this.myUserId) {
        throw new Error('TwitterユーザーIDが設定されていません');
      }
      const response = await this.client.v2.userTimeline(this.myUserId, {
        max_results: 10,
        exclude: 'replies',
      });
      return response.data.data.map((tweet) => tweet.id);
    } catch (error: any) {
      console.error(`\x1b[31mTweet error: ${error.message}\x1b[0m`);
      throw error;
    }
  }

  private async replyTweet(replyId: string, text: string) {
    try {
      const response = await this.client.v2.reply(text, replyId);
      console.log(
        `\x1b[32mTweet replied successfully ${response.data.id}\x1b[0m`
      );
    } catch (error: any) {
      console.error(`\x1b[31mTweet error: ${error.message}\x1b[0m`);
      throw error;
    }
  }

  public async initialize() {
    try {
      this.setupEventHandlers();
    } catch (error) {
      if (error instanceof Error && error.message.includes('429')) {
        const apiError = error as any;
        if (apiError.rateLimit?.reset) {
          const resetTime = apiError.rateLimit.reset * 1000;
          const now = Date.now();
          const waitTime = resetTime - now + 10000;

          console.warn(
            `\x1b[33mTwitter rate limit reached, waiting until ${new Date(
              resetTime
            ).toISOString()} (${waitTime / 1000}s)\x1b[0m`
          );

          await new Promise((resolve) => setTimeout(resolve, waitTime));
          await this.initialize();
        } else {
          console.warn(
            '\x1b[33mTwitter rate limit reached, waiting before retry...\x1b[0m'
          );
          await new Promise((resolve) => setTimeout(resolve, 5000));
          await this.initialize();
        }
      } else {
        console.error(`\x1b[31mTwitter initialization error: ${error}\x1b[0m`);
        throw error;
      }
    }
  }

  /**
   * 指定されたツイートIDのリプライの中で、まだ自分が返信していない最も古いツイートを取得する
   * @param tweetId リプライを取得するツイートのID
   * @returns 最も古いリプライのツイートIDとその内容
   */
  public async getOldestUnrepliedTweet(
    tweetId: string
  ): Promise<{ id: string; text: string } | null> {
    try {
      const tweet = await this.client.v2.singleTweet(tweetId);
      const conversationId = tweet.data.conversation_id;
      const response = await this.client.v2.search(
        `conversation_id:${conversationId}`,
        {
          expansions: ['author_id'],
          'tweet.fields': [
            'in_reply_to_user_id',
            'author_id',
            'conversation_id',
            'created_at',
          ],
        }
      );

      const unrepliedTweets = response.data.data.filter(
        (reply: any) =>
          reply.in_reply_to_user_id === tweet.data.author_id &&
          reply.author_id !== this.myUserId
      );

      if (unrepliedTweets.length > 0) {
        const oldestTweet = unrepliedTweets.reduce((oldest, current) => {
          if (!oldest.created_at || !current.created_at) {
            return oldest;
          }
          return new Date(oldest.created_at) < new Date(current.created_at)
            ? oldest
            : current;
        });
        return { id: oldestTweet.id, text: oldestTweet.text };
      }

      return null;
    } catch (error: any) {
      console.error(`\x1b[31mTweet error: ${error.message}\x1b[0m`);
      throw error;
    }
  }
}

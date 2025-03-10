import { TwitterClientInput } from '@shannon/common';
import dotenv from 'dotenv';
import { TwitterApi } from 'twitter-api-v2';
import { BaseClient } from '../common/BaseClient.js';
import { getEventBus } from '../eventBus/index.js';

dotenv.config();

export class TwitterClient extends BaseClient {
  private client: TwitterApi;
  private myUserId: string | null = null;
  public isTest: boolean = false;

  private static instance: TwitterClient;

  public static getInstance(isTest: boolean = false) {
    const eventBus = getEventBus();
    if (!TwitterClient.instance) {
      TwitterClient.instance = new TwitterClient('twitter', isTest);
    }
    TwitterClient.instance.isTest = isTest;
    TwitterClient.instance.myUserId = process.env.TWITTER_USER_ID || null;
    return TwitterClient.instance;
  }

  private constructor(serviceName: 'twitter', isTest: boolean) {
    const eventBus = getEventBus();
    super(serviceName, eventBus);
    const apiKey = process.env.TWITTER_API_KEY;
    const apiKeySecret = process.env.TWITTER_API_KEY_SECRET;
    const accessToken = process.env.TWITTER_ACCESS_TOKEN;
    const accessTokenSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET;

    if (!apiKey || !apiKeySecret || !accessToken || !accessTokenSecret) {
      throw new Error('Twitter APIの認証情報が設定されていません');
    }

    this.client = new TwitterApi({
      appKey: apiKey,
      appSecret: apiKeySecret,
      accessToken: accessToken,
      accessSecret: accessTokenSecret,
    });
  }

  private setupEventHandlers() {
    this.eventBus.subscribe('twitter:status', async (event) => {
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
    this.eventBus.subscribe('twitter:post_scheduled_message', async (event) => {
      if (this.status !== 'running') return;
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
      if (this.status !== 'running') return;
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
    this.eventBus.subscribe('twitter:check_replies', async (event) => {
      if (this.status !== 'running') return;
      try {
        await this.checkAndReplyToUnrepliedTweets();
      } catch (error) {
        console.error(`\x1b[31mCheck replies error: ${error}\x1b[0m`);
      }
    });
  }

  async getUserId(username: string) {
    try {
      const response = await this.client.v2.userByUsername(username);
      if (response.data) {
        console.log(`User ID for ${username}: ${response.data.id}`);
        return response.data.id;
      }
    } catch (error) {
      console.error('Error fetching user ID:', error);
    }
  }

  private async postTweet(content: string) {
    if (this.status !== 'running') return;
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
    if (this.status !== 'running') return [];
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
    if (this.status !== 'running') return;
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
   * @param myTweet リプライを取得するツイートのID
   * @returns 最も古いリプライのツイートIDとその内容
   */
  public async getOldestUnrepliedTweet(myTweet: {
    id: string;
    text: string;
  }): Promise<{
    id: string;
    text: string;
    authorName: string;
    myTweet: string;
  } | null> {
    if (this.status !== 'running') return null;
    try {
      const tweet = await this.client.v2.singleTweet(myTweet.id, {
        'tweet.fields': ['conversation_id'],
      });
      console.log(tweet);
      const conversationId = tweet.data.conversation_id;
      console.log(conversationId);
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
      console.log(JSON.stringify(response));
      const unrepliedTweets = response.data.data.filter(
        (reply: any) =>
          reply.in_reply_to_user_id === tweet.data.author_id &&
          reply.author_id !== this.myUserId
      );
      console.log(JSON.stringify(unrepliedTweets));
      if (unrepliedTweets.length > 0) {
        const oldestTweet = unrepliedTweets.reduce((oldest, current) => {
          if (!oldest.created_at || !current.created_at) {
            return oldest;
          }
          return new Date(oldest.created_at) < new Date(current.created_at)
            ? oldest
            : current;
        });
        return {
          id: oldestTweet.id,
          text: oldestTweet.text,
          authorName: oldestTweet.author_id || '',
          myTweet: myTweet.text,
        };
      }

      return null;
    } catch (error: any) {
      console.error(`\x1b[31mTweet error: ${error.message}\x1b[0m`);
      throw error;
    }
  }

  /**
   * 24時間以内の自分のツイートを取得する
   * @returns ツイートIDの配列
   */
  private async getRecentTweets(): Promise<{ id: string; text: string }[]> {
    if (this.status !== 'running') return [];
    try {
      if (!this.myUserId) {
        throw new Error('TwitterユーザーIDが設定されていません');
      }
      const oneDayAgo = new Date();
      oneDayAgo.setHours(oneDayAgo.getHours() - 24);

      const response = await this.client.v2.userTimeline(this.myUserId, {
        max_results: 100,
        exclude: 'replies',
        'tweet.fields': ['created_at'],
      });

      return response.data.data
        .filter((tweet) => {
          const tweetDate = new Date(tweet.created_at!);
          return tweetDate > oneDayAgo;
        })
        .map((tweet) => ({
          id: tweet.id,
          text: tweet.text,
        }));
    } catch (error: any) {
      console.error(`\x1b[31mGet recent tweets error: ${error.message}\x1b[0m`);
      throw error;
    }
  }

  /**
   * 24時間以内の自分のツイートをチェックし、未返信のリプライに返信する
   */
  private async checkAndReplyToUnrepliedTweets() {
    try {
      const recentTweets = await this.getRecentTweets();

      for (const myTweet of recentTweets) {
        const unrepliedTweet = await this.getOldestUnrepliedTweet(myTweet);

        console.log(unrepliedTweet);

        if (unrepliedTweet) {
          this.eventBus.publish({
            type: 'llm:post_twitter_reply',
            memoryZone: 'twitter:post',
            data: {
              replyId: unrepliedTweet.id,
              text: unrepliedTweet.text,
              authorName: unrepliedTweet.authorName,
              myTweet: unrepliedTweet.myTweet,
            },
          });
        }
      }
    } catch (error: any) {
      console.error(`\x1b[31mCheck and reply error: ${error.message}\x1b[0m`);
      throw error;
    }
  }
}

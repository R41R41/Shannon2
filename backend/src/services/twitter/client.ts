import { TwitterClientInput, TwitterClientOutput } from '@shannon/common';
import dotenv from 'dotenv';
import { BaseClient } from '../common/BaseClient.js';
import { TwitterApi } from 'twitter-api-v2';
import { getEventBus } from '../eventBus/index.js';
import axios from "axios";
import WebSocket from 'ws';

dotenv.config();

export class TwitterClient extends BaseClient {
  private myUserId: string | null = null;
  private client: TwitterApi;
  public isTest: boolean = false;
  private apiKey: string;
  private static instance: TwitterClient;
  private email: string;
  private password: string;
  private login_data: string;
  private two_fa_code: string;
  private auth_session: string;
  private lastCheckedReplyIds: Set<string> = new Set();
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
    this.apiKey = process.env.TWITTERAPI_IO_API_KEY || '';
    this.email = process.env.TWITTER_EMAIL || '';
    this.password = process.env.TWITTER_PASSWORD || '';
    this.login_data = process.env.TWITTER_LOGIN_DATA || '';
    this.two_fa_code = process.env.TWITTER_TWO_FA_CODE || '';
    this.auth_session = process.env.TWITTER_AUTH_SESSION || '';
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
      const { text, imageUrl } = event.data as TwitterClientInput;
      try {
        if (text) {
          await this.postTweetByApi(text);
        }
      } catch (error) {
        console.error('Twitter post error:', error);
      }
    });
    this.eventBus.subscribe('twitter:post_message', async (event) => {
      if (this.status !== 'running') return;
      const { replyId, text, imageUrl } = event.data as TwitterClientInput;
      try {
        await this.postTweet(text, imageUrl ?? null, replyId ?? null);
      } catch (error) {
        console.error(`\x1b[31mTwitter post error: ${error}\x1b[0m`);
      }
    });
    this.eventBus.subscribe('twitter:get_tweet_content', async (event) => {
      if (this.status !== 'running') return;
      const { tweetId } = event.data as TwitterClientInput;
      try {
        if (tweetId) {
          const { text, createdAt, retweetCount, replyCount, likeCount, authorId, authorName, mediaUrl } = await this.fetchTweetContent(tweetId);
          this.eventBus.publish({
            type: 'tool:get_tweet_content',
            memoryZone: 'twitter:get',
            data: { text, createdAt, retweetCount, replyCount, likeCount, authorId, authorName, mediaUrl } as TwitterClientOutput,
          });
        }
      } catch (error) {
        console.error('Twitter get tweet content error:', error);
      }
    });
  }

  private async fetchTweetContent(tweetId: string) {
    const endpoint = "https://api.twitterapi.io/twitter/tweets";
    console.log("tweetId: ", tweetId);

    try {

      const options = {
        method: 'GET',
        headers: { 'X-API-Key': this.apiKey },
        params: { tweet_ids: tweetId }
      };

      const response = await axios.get(endpoint, options);
      const text = response.data.tweets?.[0]?.text;
      const createdAt = response.data.tweets?.[0]?.createdAt;
      const retweetCount = response.data.tweets?.[0]?.retweetCount;
      const replyCount = response.data.tweets?.[0]?.replyCount;
      const likeCount = response.data.tweets?.[0]?.likeCount;
      const authorId = response.data.tweets?.[0]?.author?.id;
      const authorName = response.data.tweets?.[0]?.author?.name;
      const mediaUrl = response.data.tweets?.[0]?.extendedEntities?.media?.[0]?.media_url_https;
      console.log("tweetContent: ", response.data.tweets?.[0]);
      return {
        text,
        createdAt,
        retweetCount,
        replyCount,
        likeCount,
        authorId,
        authorName,
        mediaUrl
      };
    } catch (error: any) {
      console.error("API呼び出しエラー:", error.response?.data || error.message);
      throw error;
    }
  }

  private async login1Step() {
    const endpoint = "https://api.twitterapi.io/twitter/login_by_email_or_username";
    const data = { username_or_email: this.email, password: this.password };
    const config = {
      headers: { 'X-API-Key': this.apiKey }
    };
    try {
      const response = await axios.post(endpoint, data, config);
      console.log(response.data);
      const login_data = response.data.login_data;
      const status = response.data.status;
      console.log("login_data: ", login_data);
      console.log("status: ", status);
      return { login_data, status };
    } catch (error: any) {
      console.error(`\x1b[31mLogin error: ${error.message}\x1b[0m`);
      throw error;
    }
  }

  private async login2Step() {
    const endpoint = "https://api.twitterapi.io/twitter/login_by_2fa";
    const data = { login_data: this.login_data, '2fa_code': this.two_fa_code };
    const config = {
      headers: { 'X-API-Key': this.apiKey }
    };
    try {
      const response = await axios.post(endpoint, data, config);
      console.log("response: ", response.data);
      this.auth_session = response.data.auth_session;
    } catch (error: any) {
      console.error(`\x1b[31mLogin error: ${error.message}\x1b[0m`);
      throw error;
    }
  }

  private async postTweetByApi(content: string) {
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

  private async getLatestTweets() {
    try {
      const endpoint = "https://api.twitterapi.io/twitter/user/last_tweets";
      const options = {
        method: 'GET',
        headers: { 'X-API-Key': this.apiKey },
        params: { userName: "I_am_Sh4nnon" }
      };
      const res = await axios.get(endpoint, options);
      if (res.data.status === "success") {
        const tweets = res.data.data.tweets;
        const filteredTweets = tweets.filter((tweet: any) => !tweet.is_reply);
        return filteredTweets.slice(0, 3);
      } else {
        console.error(`\x1b[31mTweet error: ${res.data.data.message}\x1b[0m`);
        return [];
      }
    } catch (error: any) {
      console.error(`\x1b[31mTweet error: ${error.message}\x1b[0m`);
      throw error;
    }
  }

  private async getReplies(tweet: any) {
    const endpoint = "https://api.twitterapi.io/twitter/tweet/replies";
    const options = {
      method: 'GET',
      headers: { 'X-API-Key': this.apiKey },
      params: { tweetId: tweet.id }
    };
    const res = await axios.get(endpoint, options);
    if (res.data.status === "success") {
      const replies = res.data.tweets;
      const filteredReplies = replies.filter((reply: any) => reply.replyCount === 0 && reply.author.id !== this.myUserId);
      return {
        reply: filteredReplies[0],
        myTweet: tweet.text
      };
    } else {
      console.error(`\x1b[31mTweet error: ${res.data.data.message}\x1b[0m`);
      return {};
    }
  }

  private async checkRepliesAndRespond() {
    try {
      const tweets = await this.getLatestTweets();
      if (tweets.length === 0) return;

      const replies: { reply: any, myTweet: any }[] = [];
      for (const tweet of tweets) {
        const { reply, myTweet } = await this.getReplies(tweet);
        if (reply) {
          replies.push({ reply, myTweet });
        }
      }
      if (replies.length === 0) return;
      console.log("replies: ", replies[0]);
      this.eventBus.publish({
        type: 'llm:post_twitter_reply',
        memoryZone: 'twitter:post',
        data: {
          replyId: replies[0].reply.id,
          text: replies[0].reply.text,
          authorName: replies[0].reply.author.name,
          myTweet: replies[0].myTweet,
        }
      });
    } catch (err: any) {
      console.error("❌ エラー:", err.response?.data || err.message);
    }
  }

  private async postTweet(content: string, mediaUrl: string | null, replyId: string | null) {
    if (this.status !== 'running') return;
    try {
      const endpoint = "https://api.twitterapi.io/twitter/create_tweet";
      const data = {
        auth_session: this.auth_session,
        tweet_text: content,
        media_id: mediaUrl ?? null,
        in_reply_to_tweet_id: replyId ?? null
      };
      const config = {
        headers: {
          'X-API-Key': this.apiKey,
        }
      };
      const response = await axios.post(endpoint, data, config);
      return response
    } catch (error: any) {
      console.error(`\x1b[31mTweet error: ${error.message}\x1b[0m`);
      return error;
    }
  }

  public async initialize() {
    try {
      // await this.login1Step();
      // await this.login2Step();
      if (!this.isTest) {
        setInterval(() => this.checkRepliesAndRespond(), 60 * 1000);
      }
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
}

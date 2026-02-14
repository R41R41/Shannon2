import {
  TwitterClientInput,
  TwitterClientOutput,
  TwitterReplyOutput,
} from '@shannon/common';
import axios, { isAxiosError } from 'axios';
import { TwitterApi } from 'twitter-api-v2';
import { config } from '../../config/env.js';
import { BaseClient } from '../common/BaseClient.js';
import { getEventBus } from '../eventBus/index.js';

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
  private proxy1: string;
  private proxy2: string;
  private proxy3: string;
  private lastCheckedReplyIds: Set<string> = new Set();
  private officialAccountUserName =
    config.twitter.usernames.aiminelab;
  private friendAccountUserNames = [
    config.twitter.usernames.yummy,
    config.twitter.usernames.rai,
    config.twitter.usernames.guriko,
  ].filter(Boolean) as string[];

  public static getInstance(isTest: boolean = false) {
    const eventBus = getEventBus();
    if (!TwitterClient.instance) {
      TwitterClient.instance = new TwitterClient('twitter', isTest);
    }
    TwitterClient.instance.isTest = isTest;
    TwitterClient.instance.myUserId = config.twitter.userId || null;
    return TwitterClient.instance;
  }

  private constructor(serviceName: 'twitter', isTest: boolean) {
    const eventBus = getEventBus();
    super(serviceName, eventBus);
    this.apiKey = config.twitter.twitterApiIoKey;
    this.email = config.twitter.email;
    this.password = config.twitter.password;
    this.login_data = config.twitter.loginData;
    this.two_fa_code = config.twitter.twoFaCode;
    this.auth_session = config.twitter.authSession;
    this.proxy1 = config.twitter.proxy1;
    this.proxy2 = config.twitter.proxy2;
    this.proxy3 = config.twitter.proxy3;
    const apiKey = config.twitter.apiKey;
    const apiKeySecret = config.twitter.apiKeySecret;
    const accessToken = config.twitter.accessToken;
    const accessTokenSecret = config.twitter.accessTokenSecret;

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
          const {
            text,
            createdAt,
            retweetCount,
            replyCount,
            likeCount,
            authorId,
            authorName,
            mediaUrl,
          } = await this.fetchTweetContent(tweetId);
          this.eventBus.publish({
            type: 'tool:get_tweet_content',
            memoryZone: 'twitter:get',
            data: {
              text,
              createdAt,
              retweetCount,
              replyCount,
              likeCount,
              authorId,
              authorName,
              mediaUrl,
            } as TwitterClientOutput,
          });
        }
      } catch (error) {
        console.error('Twitter get tweet content error:', error);
      }
    });
  }

  private async fetchTweetContent(tweetId: string) {
    const endpoint = 'https://api.twitterapi.io/twitter/tweets';
    console.log('tweetId: ', tweetId);

    try {
      const options = {
        method: 'GET',
        headers: { 'X-API-Key': this.apiKey },
        params: { tweet_ids: tweetId },
      };

      const response = await axios.get(endpoint, options);
      const text = response.data.tweets?.[0]?.text;
      const createdAt = response.data.tweets?.[0]?.createdAt;
      const retweetCount = response.data.tweets?.[0]?.retweetCount;
      const replyCount = response.data.tweets?.[0]?.replyCount;
      const likeCount = response.data.tweets?.[0]?.likeCount;
      const authorId = response.data.tweets?.[0]?.author?.id;
      const authorName = response.data.tweets?.[0]?.author?.name;
      const mediaUrl =
        response.data.tweets?.[0]?.extendedEntities?.media?.[0]
          ?.media_url_https;
      console.log('tweetContent: ', response.data.tweets?.[0]);
      return {
        text,
        createdAt,
        retweetCount,
        replyCount,
        likeCount,
        authorId,
        authorName,
        mediaUrl,
      };
    } catch (error: unknown) {
      const errMsg = isAxiosError(error)
        ? (error.response?.data ?? error.message)
        : error instanceof Error ? error.message : String(error);
      console.error('API呼び出しエラー:', errMsg);
      throw error;
    }
  }

  private async login1Step() {
    const endpoint =
      'https://api.twitterapi.io/twitter/login_by_email_or_username';
    const data = { username_or_email: this.email, password: this.password };
    const config = {
      headers: { 'X-API-Key': this.apiKey },
    };
    try {
      const response = await axios.post(endpoint, data, config);
      console.log(response.data);
      const login_data = response.data.login_data;
      const status = response.data.status;
      console.log('login_data: ', login_data);
      console.log('status: ', status);
      return { login_data, status };
    } catch (error: unknown) {
      console.error(`\x1b[31mLogin error: ${error instanceof Error ? error.message : String(error)}\x1b[0m`);
      throw error;
    }
  }

  private async login2Step() {
    const endpoint = 'https://api.twitterapi.io/twitter/login_by_2fa';
    const data = { login_data: this.login_data, '2fa_code': this.two_fa_code };
    const config = {
      headers: { 'X-API-Key': this.apiKey },
    };
    try {
      const response = await axios.post(endpoint, data, config);
      console.log('response: ', response.data);
      this.auth_session = response.data.auth_session;
    } catch (error: unknown) {
      console.error(`\x1b[31mLogin error: ${error instanceof Error ? error.message : String(error)}\x1b[0m`);
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
    } catch (error: unknown) {
      console.error(`\x1b[31mTweet error: ${error instanceof Error ? error.message : String(error)}\x1b[0m`);
      throw error;
    }
  }

  private async getLatestTweets() {
    try {
      const endpoint = 'https://api.twitterapi.io/twitter/user/last_tweets';
      const options = {
        method: 'GET',
        headers: { 'X-API-Key': this.apiKey },
        params: { userName: 'I_am_Shannon' },
      };
      const res = await axios.get(endpoint, options);
      if (res.data.status === 'success') {
        const tweets = res.data.data.tweets;
        const filteredTweets = tweets.filter((tweet: any) => !tweet.is_reply);
        return filteredTweets.slice(0, 3);
      } else {
        console.error(`\x1b[31mTweet error: ${res.data.data.message}\x1b[0m`);
        return [];
      }
    } catch (error: unknown) {
      console.error(`\x1b[31mTweet error: ${error instanceof Error ? error.message : String(error)}\x1b[0m`);
      throw error;
    }
  }

  private async getReplies(tweet: any) {
    const endpoint = 'https://api.twitterapi.io/twitter/tweet/replies';
    const options = {
      method: 'GET',
      headers: { 'X-API-Key': this.apiKey },
      params: { tweetId: tweet.id },
    };
    const res = await axios.get(endpoint, options);
    if (res.data.status === 'success') {
      const replies = res.data.tweets;
      const filteredReplies = replies.filter(
        (reply: any) =>
          reply.replyCount === 0 && reply.author.id !== this.myUserId
      );
      return {
        reply: filteredReplies[0],
        myTweet: tweet.text,
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

      const replies: { reply: any; myTweet: any }[] = [];
      for (const tweet of tweets) {
        const { reply, myTweet } = await this.getReplies(tweet);
        if (reply) {
          replies.push({ reply, myTweet });
        }
      }
      if (replies.length === 0) return;
      console.log('replies: ', replies[0]);
      this.eventBus.publish({
        type: 'llm:post_twitter_reply',
        memoryZone: 'twitter:post',
        data: {
          replyId: replies[0].reply.id,
          text: replies[0].reply.text,
          authorName: replies[0].reply.author.name,
          repliedTweet: replies[0].myTweet,
          repliedTweetAuthorName: replies[0].reply.author.name,
        } as TwitterReplyOutput,
      });
    } catch (err: unknown) {
      const errMsg = isAxiosError(err)
        ? (err.response?.data ?? err.message)
        : err instanceof Error ? err.message : String(err);
      console.error('❌ エラー:', errMsg);
    }
  }

  private async postTweet(
    content: string,
    mediaUrl: string | null,
    replyId: string | null
  ) {
    if (this.status !== 'running') return;
    try {
      const endpoint = 'https://api.twitterapi.io/twitter/create_tweet';
      const data = {
        auth_session: this.auth_session,
        tweet_text: content,
        media_id: mediaUrl ?? null,
        in_reply_to_tweet_id: replyId ?? null,
        proxy: this.proxy1,
      };
      const config = {
        headers: {
          'X-API-Key': this.apiKey,
        },
      };
      const response = await axios.post(endpoint, data, config);
      return response;
    } catch (error: unknown) {
      console.error(`\x1b[31mTweet error: ${error instanceof Error ? error.message : String(error)}\x1b[0m`);
      return error;
    }
  }

  /**
   * 公式アカウントの1時間以内のツイートに自動でいいね・リツイート
   */
  private async autoLikeAndRetweetOfficialTweets() {
    if (!this.officialAccountUserName) return;
    try {
      const endpoint = 'https://api.twitterapi.io/twitter/user/last_tweets';
      const options = {
        method: 'GET',
        headers: { 'X-API-Key': this.apiKey },
        params: { userName: this.officialAccountUserName },
      };
      const res = await axios.get(endpoint, options);
      if (res.data.status !== 'success') return;
      const tweets = res.data.data.tweets;
      const now = Date.now();
      for (const tweet of tweets) {
        const createdAt = new Date(
          tweet.created_at || tweet.createdAt
        ).getTime();
        if (now - createdAt > 60 * 60 * 1000) continue; // 1時間以内のみ
        if (tweet.likeCount === 0) {
          await this.likeTweet(tweet.id);
        }
        if (tweet.retweetCount === 0) {
          await this.retweetTweet(tweet.id);
        }
        const replied = await this.hasRepliedToTweet(tweet.id);
        if (replied) continue; // 自分が返信している場合はスキップ
        this.eventBus.publish({
          type: 'llm:post_twitter_reply',
          memoryZone: 'twitter:post',
          data: {
            replyId: tweet.id,
            text: tweet.text,
            authorName: tweet.author.name,
          } as TwitterReplyOutput,
        });
      }
    } catch (e) {
      console.error('公式アカウント自動いいね・リツイート・返信失敗:', e);
    }
  }

  /**
   * 友達アカウントの1時間以内のツイートに自動でいいね・返信
   */
  private async autoLikeAndReplyFriendTweets() {
    if (!this.friendAccountUserNames.length) return;
    try {
      const now = Date.now();
      for (const friendUserName of this.friendAccountUserNames) {
        const endpoint = 'https://api.twitterapi.io/twitter/user/last_tweets';
        const options = {
          method: 'GET',
          headers: { 'X-API-Key': this.apiKey },
          params: { userName: friendUserName },
        };
        const res = await axios.get(endpoint, options);
        if (res.data.status !== 'success') continue;
        const tweets = res.data.data.tweets;
        // 1時間以内 & 自分が返信していないツイートを抽出
        const notRepliedTweets = [];
        for (const tweet of tweets) {
          const createdAt = new Date(
            tweet.created_at || tweet.createdAt
          ).getTime();
          if (now - createdAt > 60 * 60 * 1000) continue;
          // 返信済み判定: 自分のリプライがあるか
          const replied = await this.hasRepliedToTweet(tweet.id);
          if (!replied && tweet.likeCount === 0) {
            await this.likeTweet(tweet.id);
            notRepliedTweets.push(tweet);
          }
        }
        // ランダムに1件選んで返信
        if (notRepliedTweets.length > 0) {
          const randomTweet =
            notRepliedTweets[
            Math.floor(Math.random() * notRepliedTweets.length)
            ];

          let repliedTweetText = '';
          let repliedTweetAuthorName = '';

          // in_reply_to_user_idが自分のIDかどうかで分岐
          if (randomTweet.in_reply_to_user_id) {
            // 元ツイートIDを取得
            const originalTweetId =
              randomTweet.in_reply_to_status_id ||
              randomTweet.in_reply_to_tweet_id;
            if (originalTweetId) {
              const original = await this.fetchTweetContent(originalTweetId);
              repliedTweetText = original.text;
              repliedTweetAuthorName = original.authorName;
            }
          }
          this.eventBus.publish({
            type: 'llm:post_twitter_reply',
            memoryZone: 'twitter:post',
            data: {
              replyId: randomTweet.id,
              text: randomTweet.text,
              authorName: randomTweet.author.name,
              repliedTweet: repliedTweetText,
              repliedTweetAuthorName: repliedTweetAuthorName,
            } as TwitterReplyOutput,
          });
        }
      }
    } catch (e) {
      console.error('友達アカウント自動いいね・返信失敗:', e);
    }
  }

  /**
   * ツイートにいいね
   */
  private async likeTweet(tweetId: string) {
    try {
      const endpoint = 'https://api.twitterapi.io/twitter/like_tweet';
      const data = {
        auth_session: this.auth_session,
        tweet_id: tweetId,
        proxy: this.proxy2,
      };
      const config = { headers: { 'X-API-Key': this.apiKey } };
      await axios.post(endpoint, data, config);
      console.log(`ツイート ${tweetId} にいいねしました`);
    } catch (e) {
      console.error('いいね失敗:', e);
    }
  }

  /**
   * ツイートをリツイート
   */
  private async retweetTweet(tweetId: string) {
    try {
      const endpoint = 'https://api.twitterapi.io/twitter/retweet_tweet';
      const data = {
        auth_session: this.auth_session,
        tweet_id: tweetId,
        proxy: this.proxy3,
      };
      const config = { headers: { 'X-API-Key': this.apiKey } };
      await axios.post(endpoint, data, config);
      console.log(`ツイート ${tweetId} をリツイートしました`);
    } catch (e) {
      console.error('リツイート失敗:', e);
    }
  }

  /**
   * 既に自分が返信しているか判定
   */
  private async hasRepliedToTweet(tweetId: string): Promise<boolean> {
    try {
      const endpoint = 'https://api.twitterapi.io/twitter/tweet/replies';
      const options = {
        method: 'GET',
        headers: { 'X-API-Key': this.apiKey },
        params: { tweetId },
      };
      const res = await axios.get(endpoint, options);
      if (res.data.status !== 'success') return false;
      const replies = res.data.tweets;
      return replies.some((reply: any) => reply.author?.id === this.myUserId);
    } catch (e) {
      console.error('返信判定失敗:', e);
      return false;
    }
  }

  /**
   * ツイートに返信
   */
  private async replyToTweet(tweetId: string, text: string) {
    try {
      await this.postTweet(text, null, tweetId);
      console.log(`ツイート ${tweetId} に返信しました`);
    } catch (e) {
      console.error('返信失敗:', e);
    }
  }

  public async initialize() {
    try {
      // await this.login1Step();
      // await this.login2Step();
      if (!this.isTest) {
        setInterval(() => this.checkRepliesAndRespond(), 10 * 60 * 1000);
        setInterval(
          () => this.autoLikeAndRetweetOfficialTweets(),
          60 * 60 * 1000
        );
        setInterval(() => this.autoLikeAndReplyFriendTweets(), 60 * 60 * 1000);
        this.autoLikeAndRetweetOfficialTweets();
        this.autoLikeAndReplyFriendTweets();
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

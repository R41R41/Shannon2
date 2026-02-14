import {
  TwitterClientInput,
  TwitterClientOutput,
  TwitterQuoteRTOutput,
  TwitterReplyOutput,
} from '@shannon/common';
import axios, { isAxiosError } from 'axios';
import { TwitterApi } from 'twitter-api-v2';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { BaseClient } from '../common/BaseClient.js';
import { getEventBus } from '../eventBus/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** advanced_search から返されるツイートの型 */
interface TweetData {
  id: string;
  text: string;
  url: string;
  createdAt: string;
  created_at?: string;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  isReply: boolean;
  inReplyToId?: string;
  inReplyToUserId?: string;
  in_reply_to_status_id?: string;
  in_reply_to_tweet_id?: string;
  in_reply_to_user_id?: string;
  author: {
    id: string;
    userName: string;
    name: string;
  };
}

/** 監視対象アカウントの設定 */
interface MonitoredAccountConfig {
  userName: string;
  /** 必ずいいねするか */
  alwaysLike: boolean;
  /** 返信するか (確率制御) */
  reply: boolean;
  /** 必ず引用RTするか */
  alwaysQuoteRT: boolean;
}

// ---------------------------------------------------------------------------
// TwitterClient
// ---------------------------------------------------------------------------

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
  private login_cookies: string;
  private proxy1: string;
  private proxy2: string;
  private proxy3: string;

  /** 自分のツイートへの返信チェック用 (既存機能) */
  private lastCheckedReplyIds: Set<string> = new Set();

  /** 処理済みツイートID (重複アクション防止) */
  private processedTweetIds: Set<string> = new Set();

  /** advanced_search 用の最終チェック時刻 */
  private lastCheckedTime: Date = new Date(Date.now() - 2 * 60 * 60 * 1000);

  /** 返信確率 (0.0〜1.0) */
  private replyProbability: number;

  /** ポーリング間隔 (ミリ秒) */
  private monitorIntervalMs: number;

  /** 監視対象アカウント設定 */
  private monitoredAccounts: MonitoredAccountConfig[];

  /** ai_mine_lab のユーザー名 */
  private officialAccountUserName: string;

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
    this.login_cookies = config.twitter.loginCookies || config.twitter.authSession;
    this.proxy1 = config.twitter.proxy1;
    this.proxy2 = config.twitter.proxy2;
    this.proxy3 = config.twitter.proxy3;
    this.replyProbability = config.twitter.replyProbability;
    this.monitorIntervalMs = config.twitter.monitorIntervalMs;

    this.officialAccountUserName = config.twitter.usernames.aiminelab;

    // 監視対象アカウント設定 (4アカウント統一)
    const allUserNames = [
      config.twitter.usernames.rai,
      config.twitter.usernames.yummy,
      config.twitter.usernames.guriko,
      config.twitter.usernames.aiminelab,
    ].filter(Boolean) as string[];

    this.monitoredAccounts = allUserNames.map((userName) => ({
      userName,
      alwaysLike: true,
      reply: true,
      // ai_mine_lab のみ引用RT
      alwaysQuoteRT: userName === this.officialAccountUserName,
    }));

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

  // =========================================================================
  // Event Handlers
  // =========================================================================

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
          await this.postTweetByApi(text);
        }
      } catch (error) {
        logger.error('Twitter post error:', error);
      }
    });

    this.eventBus.subscribe('twitter:post_message', async (event) => {
      if (this.status !== 'running') return;
      const { replyId, text, imageUrl, quoteTweetUrl } = event.data as TwitterClientInput;
      try {
        if (quoteTweetUrl) {
          // 引用RTとしてツイート投稿
          await this.postQuoteTweet(text, quoteTweetUrl);
        } else {
          await this.postTweet(text, imageUrl ?? null, replyId ?? null);
        }
      } catch (error) {
        logger.error('Twitter post error:', error);
      }
    });

    this.eventBus.subscribe('twitter:get_tweet_content', async (event) => {
      if (this.status !== 'running') return;
      const { tweetId } = event.data as TwitterClientInput;
      try {
        if (tweetId) {
          const tweetContent = await this.fetchTweetContent(tweetId);
          this.eventBus.publish({
            type: 'tool:get_tweet_content',
            memoryZone: 'twitter:get',
            data: tweetContent as TwitterClientOutput,
          });
        }
      } catch (error) {
        logger.error('Twitter get tweet content error:', error);
      }
    });
  }

  // =========================================================================
  // Tweet Fetching
  // =========================================================================

  private async fetchTweetContent(tweetId: string) {
    const endpoint = 'https://api.twitterapi.io/twitter/tweets';

    try {
      const options = {
        method: 'GET' as const,
        headers: { 'X-API-Key': this.apiKey },
        params: { tweet_ids: tweetId },
      };

      const response = await axios.get(endpoint, options);
      const tweet = response.data.tweets?.[0];
      return {
        text: tweet?.text,
        createdAt: tweet?.createdAt,
        retweetCount: tweet?.retweetCount,
        replyCount: tweet?.replyCount,
        likeCount: tweet?.likeCount,
        authorId: tweet?.author?.id,
        authorName: tweet?.author?.name,
        mediaUrl: tweet?.extendedEntities?.media?.[0]?.media_url_https,
      };
    } catch (error: unknown) {
      const errMsg = isAxiosError(error)
        ? (error.response?.data ?? error.message)
        : error instanceof Error ? error.message : String(error);
      logger.error('API呼び出しエラー:', errMsg);
      throw error;
    }
  }

  // =========================================================================
  // Login
  // =========================================================================

  private async login1Step() {
    const endpoint =
      'https://api.twitterapi.io/twitter/login_by_email_or_username';
    const data = { username_or_email: this.email, password: this.password };
    const reqConfig = { headers: { 'X-API-Key': this.apiKey } };
    try {
      const response = await axios.post(endpoint, data, reqConfig);
      const login_data = response.data.login_data;
      const status = response.data.status;
      logger.info(`Login step 1: ${status}`, 'cyan');
      return { login_data, status };
    } catch (error: unknown) {
      logger.error(`Login error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async login2Step() {
    const endpoint = 'https://api.twitterapi.io/twitter/login_by_2fa';
    const data = { login_data: this.login_data, '2fa_code': this.two_fa_code };
    const reqConfig = { headers: { 'X-API-Key': this.apiKey } };
    try {
      const response = await axios.post(endpoint, data, reqConfig);
      this.auth_session = response.data.auth_session;
      logger.success('Login step 2 completed');
    } catch (error: unknown) {
      logger.error(`Login error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  // =========================================================================
  // Tweet Posting
  // =========================================================================

  /** twitter-api-v2 経由でツイート (スケジュール投稿用) */
  private async postTweetByApi(content: string) {
    if (this.status !== 'running') return;
    try {
      const response = await this.client.v2.tweet(content);
      logger.success(`Tweet posted successfully ${response.data.id}`);
    } catch (error: unknown) {
      logger.error(`Tweet error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /** twitterapi.io v1 経由でツイート (返信含む) */
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
      const reqConfig = { headers: { 'X-API-Key': this.apiKey } };
      const response = await axios.post(endpoint, data, reqConfig);
      return response;
    } catch (error: unknown) {
      logger.error(`Tweet error: ${error instanceof Error ? error.message : String(error)}`);
      return error;
    }
  }

  /**
   * twitterapi.io v2 経由で引用リツイート
   * create_tweet_v2 の attachment_url パラメータを使用
   */
  private async postQuoteTweet(content: string, quoteTweetUrl: string) {
    if (this.status !== 'running') return;
    try {
      const endpoint = 'https://api.twitterapi.io/twitter/create_tweet_v2';
      const data = {
        login_cookies: this.login_cookies,
        tweet_text: content,
        attachment_url: quoteTweetUrl,
        proxy: this.proxy1,
      };
      const reqConfig = { headers: { 'X-API-Key': this.apiKey } };
      const response = await axios.post(endpoint, data, reqConfig);
      logger.success(`引用RT投稿成功: ${response.data?.tweet_id ?? 'OK'}`);
      return response;
    } catch (error: unknown) {
      logger.error(`引用RT投稿失敗: ${error instanceof Error ? error.message : String(error)}`);
      return error;
    }
  }

  // =========================================================================
  // Tweet Actions (いいね・リツイート)
  // =========================================================================

  /** ツイートにいいね */
  private async likeTweet(tweetId: string) {
    try {
      const endpoint = 'https://api.twitterapi.io/twitter/like_tweet';
      const data = {
        auth_session: this.auth_session,
        tweet_id: tweetId,
        proxy: this.proxy2,
      };
      const reqConfig = { headers: { 'X-API-Key': this.apiKey } };
      await axios.post(endpoint, data, reqConfig);
      logger.info(`♥ ツイート ${tweetId} にいいねしました`, 'green');
    } catch (e) {
      logger.error('いいね失敗:', e);
    }
  }

  /** ツイートをリツイート */
  private async retweetTweet(tweetId: string) {
    try {
      const endpoint = 'https://api.twitterapi.io/twitter/retweet_tweet';
      const data = {
        auth_session: this.auth_session,
        tweet_id: tweetId,
        proxy: this.proxy3,
      };
      const reqConfig = { headers: { 'X-API-Key': this.apiKey } };
      await axios.post(endpoint, data, reqConfig);
      logger.info(`🔁 ツイート ${tweetId} をリツイートしました`, 'green');
    } catch (e) {
      logger.error('リツイート失敗:', e);
    }
  }

  // =========================================================================
  // 自分のツイートへのリプライ検知 (既存機能)
  // =========================================================================

  private async getLatestTweets(): Promise<TweetData[]> {
    try {
      const endpoint = 'https://api.twitterapi.io/twitter/user/last_tweets';
      const options = {
        method: 'GET' as const,
        headers: { 'X-API-Key': this.apiKey },
        params: { userName: 'I_am_Shannon' },
      };
      const res = await axios.get(endpoint, options);
      if (res.data.status === 'success') {
        const tweets = res.data.data.tweets as TweetData[];
        return tweets.filter((tweet) => !tweet.isReply).slice(0, 3);
      } else {
        logger.error(`Tweet error: ${res.data.data?.message}`);
        return [];
      }
    } catch (error: unknown) {
      logger.error(`Tweet error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async getReplies(tweet: TweetData) {
    const endpoint = 'https://api.twitterapi.io/twitter/tweet/replies';
    const options = {
      method: 'GET' as const,
      headers: { 'X-API-Key': this.apiKey },
      params: { tweetId: tweet.id },
    };
    const res = await axios.get(endpoint, options);
    if (res.data.status === 'success') {
      const replies = res.data.tweets as TweetData[];
      const filteredReplies = replies.filter(
        (reply) =>
          reply.replyCount === 0 && reply.author.id !== this.myUserId
      );
      return {
        reply: filteredReplies[0],
        myTweet: tweet.text,
      };
    } else {
      logger.error(`Tweet error: ${res.data.data?.message}`);
      return {};
    }
  }

  private async checkRepliesAndRespond() {
    try {
      const tweets = await this.getLatestTweets();
      if (tweets.length === 0) return;

      const replies: { reply: TweetData; myTweet: string }[] = [];
      for (const tweet of tweets) {
        const { reply, myTweet } = await this.getReplies(tweet);
        if (reply && myTweet) {
          replies.push({ reply, myTweet });
        }
      }
      if (replies.length === 0) return;
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
      logger.error(`リプライ検知エラー: ${JSON.stringify(errMsg)}`);
    }
  }

  // =========================================================================
  // 統合監視: advanced_search による一括ポーリング
  // =========================================================================

  /**
   * UTC形式の時刻文字列を返す (advanced_search の since/until 用)
   * 形式: "YYYY-MM-DD_HH:MM:SS_UTC"
   */
  private formatTimeForSearch(date: Date): string {
    const y = date.getUTCFullYear();
    const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const h = String(date.getUTCHours()).padStart(2, '0');
    const mi = String(date.getUTCMinutes()).padStart(2, '0');
    const s = String(date.getUTCSeconds()).padStart(2, '0');
    return `${y}-${mo}-${d}_${h}:${mi}:${s}_UTC`;
  }

  /**
   * 全監視対象アカウントの新着ツイートを advanced_search で一括取得し、
   * アカウントごとのルールに従ってアクションを実行する。
   *
   * - 全アカウント: 必ずいいね
   * - 全アカウント: 確率で返信 (replyProbability)
   * - ai_mine_lab: 必ず引用RT
   */
  private async autoMonitorAccounts() {
    if (this.monitoredAccounts.length === 0) return;

    try {
      const now = new Date();
      const sinceStr = this.formatTimeForSearch(this.lastCheckedTime);
      const untilStr = this.formatTimeForSearch(now);

      // 全アカウントを OR で結合した検索クエリ
      const fromClauses = this.monitoredAccounts
        .map((a) => `from:${a.userName}`)
        .join(' OR ');
      const query = `(${fromClauses}) since:${sinceStr} until:${untilStr}`;

      logger.info(`🔍 Twitter監視: ${query}`, 'cyan');

      // advanced_search でツイート取得 (ページネーション対応)
      const allTweets: TweetData[] = [];
      let nextCursor: string | null = null;

      do {
        const params: Record<string, string> = {
          query,
          queryType: 'Latest',
        };
        if (nextCursor) params.cursor = nextCursor;

        const res = await axios.get(
          'https://api.twitterapi.io/twitter/tweet/advanced_search',
          {
            headers: { 'X-API-Key': this.apiKey },
            params,
          }
        );

        if (res.data.status !== 'success') {
          logger.error(`advanced_search エラー: ${res.data.message}`);
          break;
        }

        const tweets = (res.data.tweets ?? []) as TweetData[];
        allTweets.push(...tweets);

        if (res.data.has_next_page && res.data.next_cursor) {
          nextCursor = res.data.next_cursor;
        } else {
          nextCursor = null;
        }
      } while (nextCursor);

      // 最終チェック時刻を更新
      this.lastCheckedTime = now;

      if (allTweets.length === 0) {
        logger.info('📭 新着ツイートなし', 'cyan');
        return;
      }

      logger.info(`📬 ${allTweets.length}件の新着ツイートを検出`, 'green');

      // 各ツイートに対してアクション実行
      for (const tweet of allTweets) {
        // 既に処理済みならスキップ
        if (this.processedTweetIds.has(tweet.id)) continue;
        this.processedTweetIds.add(tweet.id);

        const authorUserName = tweet.author?.userName;
        if (!authorUserName) continue;

        // このツイートのアカウント設定を取得
        const accountConfig = this.monitoredAccounts.find(
          (a) => a.userName.toLowerCase() === authorUserName.toLowerCase()
        );
        if (!accountConfig) continue;

        logger.info(
          `📝 @${authorUserName}: "${tweet.text.slice(0, 50)}..."`,
          'cyan'
        );

        // 1) 必ずいいね
        if (accountConfig.alwaysLike) {
          await this.likeTweet(tweet.id);
        }

        // 2) 必ず引用RT (ai_mine_lab のみ)
        if (accountConfig.alwaysQuoteRT) {
          const tweetUrl = tweet.url || `https://x.com/${authorUserName}/status/${tweet.id}`;
          this.eventBus.publish({
            type: 'llm:post_twitter_quote_rt',
            memoryZone: 'twitter:post',
            data: {
              tweetId: tweet.id,
              tweetUrl,
              text: tweet.text,
              authorName: tweet.author.name,
              authorUserName,
            } as TwitterQuoteRTOutput,
          });
        }

        // 3) 確率で返信
        if (accountConfig.reply && Math.random() < this.replyProbability) {
          let repliedTweetText = '';
          let repliedTweetAuthorName = '';

          // 返信ツイートの場合は元ツイートの情報も取得
          if (tweet.inReplyToId || tweet.in_reply_to_status_id || tweet.in_reply_to_tweet_id) {
            const originalTweetId =
              tweet.inReplyToId ||
              tweet.in_reply_to_status_id ||
              tweet.in_reply_to_tweet_id;
            if (originalTweetId) {
              try {
                const original = await this.fetchTweetContent(originalTweetId);
                repliedTweetText = original.text ?? '';
                repliedTweetAuthorName = original.authorName ?? '';
              } catch {
                // 元ツイート取得失敗は無視
              }
            }
          }

          this.eventBus.publish({
            type: 'llm:post_twitter_reply',
            memoryZone: 'twitter:post',
            data: {
              replyId: tweet.id,
              text: tweet.text,
              authorName: tweet.author.name,
              repliedTweet: repliedTweetText,
              repliedTweetAuthorName,
            } as TwitterReplyOutput,
          });
        }
      }

      // processedTweetIds が際限なく増えるのを防ぐ (最大1000件保持)
      if (this.processedTweetIds.size > 1000) {
        const idsArray = Array.from(this.processedTweetIds);
        this.processedTweetIds = new Set(idsArray.slice(-500));
      }
    } catch (e) {
      logger.error('Twitter監視エラー:', e);
    }
  }

  // =========================================================================
  // Initialization
  // =========================================================================

  public async initialize() {
    try {
      // await this.login1Step();
      // await this.login2Step();
      if (!this.isTest) {
        // 自分のツイートへのリプライ検知 (10分ごと)
        setInterval(() => this.checkRepliesAndRespond(), 10 * 60 * 1000);

        // 統合監視: 全アカウントの新着ツイートを一括チェック
        setInterval(
          () => this.autoMonitorAccounts(),
          this.monitorIntervalMs
        );

        // 初回実行
        this.autoMonitorAccounts();
      }
      this.setupEventHandlers();
    } catch (error) {
      if (error instanceof Error && error.message.includes('429')) {
        const apiError = error as { rateLimit?: { reset: number } };
        if (apiError.rateLimit?.reset) {
          const resetTime = apiError.rateLimit.reset * 1000;
          const now = Date.now();
          const waitTime = resetTime - now + 10000;

          logger.warn(
            `Twitter rate limit reached, waiting until ${new Date(
              resetTime
            ).toISOString()} (${waitTime / 1000}s)`
          );

          await new Promise((resolve) => setTimeout(resolve, waitTime));
          await this.initialize();
        } else {
          logger.warn('Twitter rate limit reached, waiting before retry...');
          await new Promise((resolve) => setTimeout(resolve, 5000));
          await this.initialize();
        }
      } else {
        logger.error(`Twitter initialization error: ${error}`);
        throw error;
      }
    }
  }
}

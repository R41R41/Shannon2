import {
  AutoTweetMode,
  MemberTweetInput,
  TwitterActionResult,
  TwitterAutoTweetInput,
  TwitterClientInput,
  TwitterClientOutput,
  TwitterQuoteRTOutput,
  TwitterReplyOutput,
  TwitterTrendData,
} from '@shannon/common';
import axios, { isAxiosError } from 'axios';
import { LRUSet } from '../../utils/LRUSet.js';
import { retryWithBackoff } from '../../utils/retryWithBackoff.js';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import fs from 'fs';
import path from 'path';
import { TwitterApi } from 'twitter-api-v2';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

// 処理済みツイートID の永続化ファイルパス
const PROCESSED_IDS_FILE = path.resolve('saves/processed_tweet_ids.json');
// 日次返信カウンタの永続化ファイルパス
const DAILY_REPLY_COUNT_FILE = path.resolve('saves/daily_reply_count.json');
// login_cookies の永続化ファイルパス
const LOGIN_COOKIES_FILE = path.resolve('saves/twitter_login_cookies.json');
// 自動投稿カウンタの永続化ファイルパス
const AUTO_POST_COUNT_FILE = path.resolve('saves/auto_post_count.json');
// 直近の自動投稿テキスト永続化ファイルパス
const RECENT_AUTO_POSTS_FILE = path.resolve('saves/recent_auto_posts.json');
// 当日の投稿予定時刻スケジュールの永続化ファイルパス
const DAILY_SCHEDULE_FILE = path.resolve('saves/auto_post_daily_schedule.json');
// 直近ポスト保持件数
const MAX_RECENT_AUTO_POSTS = 20;
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
  /** FCAで返信/引用RTを自動判断するか (メンバー用) */
  memberFCA: boolean;
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
  private totp_secret: string;
  private auth_session: string;
  private login_cookies: string;
  private userName: string;
  private proxy1: string;
  private proxy2: string;
  private proxy3: string;

  /** 自分のツイートへの返信チェック用 (既存機能) */
  private lastCheckedReplyIds: Set<string> = new Set();

  /** 処理済みツイートID (重複アクション防止、ファイル永続化) */
  public processedTweetIds: LRUSet<string> = new LRUSet(1000);

  /** 1日あたりの返信カウンタ */
  private dailyReplyCount = 0;
  /** カウンタの日付 (YYYY-MM-DD JST) */
  private dailyReplyDate = '';
  /** 1日の返信上限 */
  private maxRepliesPerDay: number;

  /** 直近の自動投稿エントリ（text / quoteUrl / topic を一体管理） */
  private recentPostEntries: Array<{ text: string; quoteUrl?: string; topic?: string }> = [];

  /** recentPostEntries から text 配列を生成 */
  private get recentAutoPosts(): string[] {
    return this.recentPostEntries.map((e) => e.text);
  }

  /** recentPostEntries から quoteUrl 配列を生成（undefined は除く） */
  private get recentQuoteUrls(): string[] {
    return this.recentPostEntries.filter((e) => e.quoteUrl).map((e) => e.quoteUrl!);
  }

  /** recentPostEntries から topic 配列を生成（undefined は除く） */
  private get recentTopics(): string[] {
    return this.recentPostEntries.filter((e) => e.topic).map((e) => e.topic!);
  }

  /** 直近ポストをファイルから読み込む */
  private loadRecentPosts(): void {
    try {
      if (fs.existsSync(RECENT_AUTO_POSTS_FILE)) {
        const raw = JSON.parse(fs.readFileSync(RECENT_AUTO_POSTS_FILE, 'utf-8'));
        if (Array.isArray(raw)) {
          this.recentPostEntries = raw
            .map((r: any) => ({
              text: typeof r === 'string' ? r : (r.text || ''),
              ...(r.quoteUrl ? { quoteUrl: r.quoteUrl } : {}),
              ...(r.topic ? { topic: r.topic } : {}),
            }))
            .filter((e) => e.text)
            .slice(-MAX_RECENT_AUTO_POSTS);
          logger.info(
            `📋 直近ポスト: ${this.recentPostEntries.length}件, 引用URL: ${this.recentQuoteUrls.length}件, トピック: ${this.recentTopics.length}件を復元`,
            'cyan'
          );
        }
      }
    } catch (err) {
      logger.warn(`📋 直近ポストファイル読み込み失敗: ${err}`);
    }
  }

  /** 直近ポストを追加してファイルに保存する */
  private saveRecentPost(text: string, quoteUrl?: string, topic?: string): void {
    this.recentPostEntries.push({
      text,
      ...(quoteUrl ? { quoteUrl } : {}),
      ...(topic ? { topic } : {}),
    });
    if (this.recentPostEntries.length > MAX_RECENT_AUTO_POSTS) {
      this.recentPostEntries = this.recentPostEntries.slice(-MAX_RECENT_AUTO_POSTS);
    }
    try {
      fs.writeFileSync(RECENT_AUTO_POSTS_FILE, JSON.stringify(this.recentPostEntries, null, 2));
    } catch (err) {
      logger.warn(`📋 直近ポスト保存失敗: ${err}`);
    }
  }

  /** 指定URLを最近引用RTしたか */
  public hasRecentlyQuoted(url: string): boolean {
    if (!url) return false;
    const tweetId = url.match(/status\/(\d+)/)?.[1];
    return this.recentQuoteUrls.some((u) => {
      if (u === url) return true;
      const existingId = u.match(/status\/(\d+)/)?.[1];
      return tweetId && existingId && tweetId === existingId;
    });
  }

  /** 加重ランダムでAutoTweetモードを選択 */
  private selectAutoTweetMode(): AutoTweetMode {
    const weights: [AutoTweetMode, number][] = [
      ['original', 20],
      ['trend', 30],
      ['watchlist', 30],
      ['big_account_quote', 20],
    ];
    const total = weights.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [mode, weight] of weights) {
      r -= weight;
      if (r <= 0) return mode;
    }
    return 'trend';
  }

  /** 処理済みIDをファイルから読み込む */
  private loadProcessedIds(): void {
    try {
      if (fs.existsSync(PROCESSED_IDS_FILE)) {
        const data = JSON.parse(fs.readFileSync(PROCESSED_IDS_FILE, 'utf-8'));
        if (Array.isArray(data)) {
          this.processedTweetIds = LRUSet.fromArray(data.slice(-1000), 1000);
          logger.info(`📋 処理済みID: ${this.processedTweetIds.size}件をファイルから復元 (LRU max=1000)`, 'cyan');
        }
      }
    } catch (err) {
      logger.warn(`📋 処理済みIDファイル読み込み失敗: ${err}`);
    }
  }

  /** 日次返信カウンタをファイルから読み込む */
  private loadDailyReplyCount(): void {
    try {
      if (fs.existsSync(DAILY_REPLY_COUNT_FILE)) {
        const data = JSON.parse(fs.readFileSync(DAILY_REPLY_COUNT_FILE, 'utf-8'));
        const todayJST = this.getTodayJST();
        if (data.date === todayJST) {
          this.dailyReplyCount = data.count ?? 0;
          this.dailyReplyDate = data.date;
          logger.info(`📋 日次返信カウンタ: ${this.dailyReplyCount}/${this.maxRepliesPerDay} (${todayJST})`, 'cyan');
        } else {
          // 日付が違う → リセット
          this.dailyReplyCount = 0;
          this.dailyReplyDate = todayJST;
          logger.info(`📋 日次返信カウンタ: 新しい日付のためリセット (${todayJST})`, 'cyan');
        }
      } else {
        this.dailyReplyDate = this.getTodayJST();
      }
    } catch (err) {
      logger.warn(`📋 日次返信カウンタ読み込み失敗: ${err}`);
      this.dailyReplyDate = this.getTodayJST();
    }
  }

  /** 日次返信カウンタをファイルに保存する */
  private saveDailyReplyCount(): void {
    try {
      const dir = path.dirname(DAILY_REPLY_COUNT_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        DAILY_REPLY_COUNT_FILE,
        JSON.stringify({ date: this.dailyReplyDate, count: this.dailyReplyCount }, null, 2)
      );
    } catch (err) {
      logger.warn(`📋 日次返信カウンタ保存失敗: ${err}`);
    }
  }

  /** 自動投稿カウンタをファイルから読み込む */
  private loadAutoPostCount(): void {
    try {
      if (fs.existsSync(AUTO_POST_COUNT_FILE)) {
        const data = JSON.parse(fs.readFileSync(AUTO_POST_COUNT_FILE, 'utf-8'));
        const todayJST = this.getTodayJST();
        if (data.date === todayJST) {
          this.autoPostCount = data.count ?? 0;
          this.autoPostDate = data.date;
          this.lastAutoPostAt = data.lastPostAt ?? 0;
          logger.info(
            `📋 自動投稿カウンタ: ${this.autoPostCount}/${this.maxAutoPostsPerDay} (${todayJST})`,
            'cyan'
          );
        } else {
          this.autoPostCount = 0;
          this.autoPostDate = todayJST;
          this.lastAutoPostAt = 0;
          logger.info(
            `📋 自動投稿カウンタ: 新しい日付のためリセット (${todayJST})`,
            'cyan'
          );
        }
      } else {
        this.autoPostDate = this.getTodayJST();
      }
    } catch (err) {
      logger.warn(`📋 自動投稿カウンタ読み込み失敗: ${err}`);
      this.autoPostDate = this.getTodayJST();
    }
  }

  /** 自動投稿カウンタをファイルに保存する */
  private saveAutoPostCount(): void {
    try {
      const dir = path.dirname(AUTO_POST_COUNT_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        AUTO_POST_COUNT_FILE,
        JSON.stringify({
          date: this.autoPostDate,
          count: this.autoPostCount,
          lastPostAt: this.lastAutoPostAt,
        }, null, 2)
      );
    } catch (err) {
      logger.warn(`📋 自動投稿カウンタ保存失敗: ${err}`);
    }
  }

  /** JST の今日の日付文字列を返す (YYYY-MM-DD) */
  private getTodayJST(): string {
    const now = new Date();
    const jst = toZonedTime(now, 'Asia/Tokyo');
    return format(jst, 'yyyy-MM-dd');
  }

  /**
   * 返信上限チェック。上限に達していたら true を返す。
   * 日付が変わっていたら自動リセット。
   */
  public isReplyLimitReached(): boolean {
    const todayJST = this.getTodayJST();
    if (this.dailyReplyDate !== todayJST) {
      // 日付リセット
      this.dailyReplyCount = 0;
      this.dailyReplyDate = todayJST;
      this.saveDailyReplyCount();
    }
    return this.dailyReplyCount >= this.maxRepliesPerDay;
  }

  /**
   * 返信カウンタをインクリメントして保存する。
   */
  public incrementReplyCount(): void {
    const todayJST = this.getTodayJST();
    if (this.dailyReplyDate !== todayJST) {
      this.dailyReplyCount = 0;
      this.dailyReplyDate = todayJST;
    }
    this.dailyReplyCount++;
    this.saveDailyReplyCount();
    logger.info(`📋 返信カウンタ: ${this.dailyReplyCount}/${this.maxRepliesPerDay}`, 'cyan');
  }

  /** 処理済みIDをファイルに保存する */
  public saveProcessedIds(): void {
    try {
      const dir = path.dirname(PROCESSED_IDS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(PROCESSED_IDS_FILE, JSON.stringify(this.processedTweetIds.toArray(), null, 2));
    } catch (err) {
      logger.warn(`📋 処理済みIDファイル保存失敗: ${err}`);
    }
  }

  /** advanced_search 用の最終チェック時刻 */
  private lastCheckedTime: Date = new Date(Date.now() - 2 * 60 * 60 * 1000);

  /** 返信確率 (0.0〜1.0) */
  private replyProbability: number;

  /** ポーリング間隔 (ミリ秒) */
  private monitorIntervalMs: number;

  // --- 自動投稿関連 ---
  /** 当日の自動投稿カウンター */
  private autoPostCount: number = 0;
  /** カウンタの日付 (YYYY-MM-DD JST) */
  private autoPostDate: string = '';
  /** 最後に自動投稿した時刻 (ms) */
  private lastAutoPostAt: number = 0;
  /** 1日あたりの自動投稿最小数 */
  private minAutoPostsPerDay: number;
  /** 1日あたりの自動投稿最大数 */
  private maxAutoPostsPerDay: number;
  /** 自動投稿の活動開始時間 (JST, 0-23) */
  private autoPostStartHour: number;
  /** 自動投稿の活動終了時間 (JST, 0-24) */
  private autoPostEndHour: number;
  /** 当日の投稿予定時刻リスト (epoch ms, 昇順) */
  private todayPostTimes: number[] = [];
  /** 次回自動投稿のタイマー */
  private autoPostTimer: ReturnType<typeof setTimeout> | null = null;
  /** 日次リセットのタイマー */
  private dailyResetTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.totp_secret = config.twitter.totpSecret;
    this.auth_session = config.twitter.authSession;
    this.login_cookies = config.twitter.loginCookies || '';
    this.userName = config.twitter.userName || '';
    this.proxy1 = config.twitter.proxy1;
    this.proxy2 = config.twitter.proxy2;
    this.proxy3 = config.twitter.proxy3;
    this.replyProbability = config.twitter.replyProbability;
    this.monitorIntervalMs = config.twitter.monitorIntervalMs;
    this.minAutoPostsPerDay = config.twitter.minAutoPostsPerDay;
    this.maxAutoPostsPerDay = config.twitter.maxAutoPostsPerDay;
    this.autoPostStartHour = config.twitter.autoPostStartHour;
    this.autoPostEndHour = config.twitter.autoPostEndHour;
    this.maxRepliesPerDay = config.twitter.maxRepliesPerDay;

    this.officialAccountUserName = config.twitter.usernames.aiminelab;

    // 監視対象アカウント設定 (4アカウント統一)
    const allUserNames = [
      config.twitter.usernames.rai,
      config.twitter.usernames.yummy,
      config.twitter.usernames.guriko,
      config.twitter.usernames.aiminelab,
    ].filter(Boolean) as string[];

    this.monitoredAccounts = allUserNames.map((userName) => {
      const isOfficial = userName === this.officialAccountUserName;
      return {
        userName,
        alwaysLike: true,
        // メンバーは FCA で処理するので reply / alwaysQuoteRT は false
        reply: isOfficial,
        alwaysQuoteRT: isOfficial,
        memberFCA: !isOfficial,
      };
    });

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

    // コンストラクタ段階で処理済みIDを復元 (webhook は initialize() 前に届く可能性がある)
    this.loadProcessedIds();
    this.loadDailyReplyCount();
    this.loadRecentPosts();
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
      const { text, quoteTweetUrl, imageUrl, topic } = event.data as TwitterClientInput;
      try {
        if (text && quoteTweetUrl) {
          if (this.hasRecentlyQuoted(quoteTweetUrl)) {
            logger.warn(`🐦 引用RT重複ブロック: ${quoteTweetUrl} は既に引用済み`);
            return;
          }
          await this.postQuoteTweet(text, quoteTweetUrl);
          this.saveRecentPost(text, quoteTweetUrl, topic ?? undefined);
        } else if (text) {
          await this.postTweet(text, imageUrl ?? null, null);
          this.saveRecentPost(text, undefined, topic ?? undefined);
        }
      } catch (error) {
        logger.error('Twitter post error:', error);
      }
    });

    this.eventBus.subscribe('twitter:post_message', async (event) => {
      if (this.status !== 'running') {
        logger.warn(`[twitter:post_message] status="${this.status}" のためスキップ`);
        this.eventBus.publish({
          type: 'tool:post_tweet_result',
          memoryZone: 'twitter:post',
          data: { isSuccess: false, errorMessage: 'Twitter service is not running' },
        });
        return;
      }
      const { replyId, text, imageUrl, quoteTweetUrl } = event.data as TwitterClientInput;
      logger.info(`[twitter:post_message] 受信: text="${text?.slice(0, 50)}" replyId=${replyId}`, 'cyan');
      try {
        if (quoteTweetUrl) {
          // 引用RTとしてツイート投稿
          await this.postQuoteTweet(text, quoteTweetUrl);
        } else {
          // twitterapi.io 経由で投稿 (返信対応)
          await this.postTweet(text, null, replyId ?? null);
        }
        this.eventBus.publish({
          type: 'tool:post_tweet_result',
          memoryZone: 'twitter:post',
          data: { isSuccess: true, errorMessage: '' },
        });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error('Twitter post error:', error);
        this.eventBus.publish({
          type: 'tool:post_tweet_result',
          memoryZone: 'twitter:post',
          data: { isSuccess: false, errorMessage: errMsg },
        });
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

    // --- LLM ツール用エンドポイント ---

    this.eventBus.subscribe('twitter:like_tweet', async (event) => {
      if (this.status !== 'running') return;
      const { tweetId } = event.data as TwitterClientInput;
      try {
        if (tweetId) {
          await this.likeTweet(tweetId);
          this.eventBus.publish({
            type: 'tool:like_tweet',
            memoryZone: 'twitter:post',
            data: { success: true, message: `ツイート ${tweetId} にいいねしました` } as TwitterActionResult,
          });
        }
      } catch (error) {
        this.eventBus.publish({
          type: 'tool:like_tweet',
          memoryZone: 'twitter:post',
          data: { success: false, message: `いいね失敗: ${error instanceof Error ? error.message : String(error)}` } as TwitterActionResult,
        });
      }
    });

    this.eventBus.subscribe('twitter:retweet_tweet', async (event) => {
      if (this.status !== 'running') return;
      const { tweetId } = event.data as TwitterClientInput;
      try {
        if (tweetId) {
          await this.retweetTweet(tweetId);
          this.eventBus.publish({
            type: 'tool:retweet_tweet',
            memoryZone: 'twitter:post',
            data: { success: true, message: `ツイート ${tweetId} をリツイートしました` } as TwitterActionResult,
          });
        }
      } catch (error) {
        this.eventBus.publish({
          type: 'tool:retweet_tweet',
          memoryZone: 'twitter:post',
          data: { success: false, message: `リツイート失敗: ${error instanceof Error ? error.message : String(error)}` } as TwitterActionResult,
        });
      }
    });

    this.eventBus.subscribe('twitter:quote_retweet', async (event) => {
      if (this.status !== 'running') return;
      const { text, quoteTweetUrl } = event.data as TwitterClientInput;
      try {
        if (text && quoteTweetUrl) {
          await this.postQuoteTweet(text, quoteTweetUrl);
          this.eventBus.publish({
            type: 'tool:quote_retweet',
            memoryZone: 'twitter:post',
            data: { success: true, message: `引用リツイートしました` } as TwitterActionResult,
          });
        }
      } catch (error) {
        this.eventBus.publish({
          type: 'tool:quote_retweet',
          memoryZone: 'twitter:post',
          data: { success: false, message: `引用リツイート失敗: ${error instanceof Error ? error.message : String(error)}` } as TwitterActionResult,
        });
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

  /**
   * twitterapi.io V2 ログイン
   * totp_secret を使って login_cookies を取得する（推奨フロー）
   */
  private async loginV2(): Promise<void> {
    const endpoint = 'https://api.twitterapi.io/twitter/user_login_v2';
    const data = {
      user_name: this.userName,
      email: this.email,
      password: this.password,
      totp_secret: this.totp_secret,
      proxy: this.proxy1,
    };
    const reqConfig = { headers: { 'X-API-Key': this.apiKey } };
    try {
      logger.info(`[loginV2] ログイン中... user_name=${this.userName}, email=${this.email}, totp_secret=${this.totp_secret ? '***' : '(empty)'}`, 'cyan');
      const response = await axios.post(endpoint, data, reqConfig);
      const resData = response.data;
      logger.debug(`[loginV2] レスポンス status: ${resData?.status}`);

      if (resData?.status === 'error') {
        throw new Error(`loginV2 failed: ${resData?.msg || resData?.message || JSON.stringify(resData).slice(0, 200)}`);
      }

      const cookies = resData?.login_cookie || resData?.login_cookies;
      if (!cookies) {
        throw new Error(`loginV2: login_cookie が返されませんでした。レスポンス: ${JSON.stringify(resData).slice(0, 300)}`);
      }
      this.login_cookies = cookies;
      logger.success(`[loginV2] ログイン成功。login_cookies 取得完了 (${cookies.length}文字)`);
      // クッキーをファイルに永続化
      try {
        const dir = path.dirname(LOGIN_COOKIES_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(LOGIN_COOKIES_FILE, JSON.stringify({ cookies, updatedAt: new Date().toISOString() }));
        logger.info('[loginV2] login_cookies をファイルに保存', 'cyan');
      } catch (e) {
        logger.warn(`[loginV2] login_cookies ファイル保存失敗: ${e}`);
      }
    } catch (error: unknown) {
      logger.error(`[loginV2] エラー: ${error instanceof Error ? error.message : String(error)}`);
      if (isAxiosError(error)) {
        logger.error(`[loginV2] レスポンス: ${JSON.stringify(error.response?.data).slice(0, 300)}`);
      }
      throw error;
    }
  }

  // =========================================================================
  // Tweet Posting
  // =========================================================================

  /** twitter-api-v2 (OAuth 1.0a) 経由でツイート (返信対応) */
  private async postTweetByApi(content: string, replyToId?: string | null) {
    if (this.status !== 'running') return;
    try {
      const options: { text: string; reply?: { in_reply_to_tweet_id: string } } = {
        text: content,
      };
      if (replyToId) {
        options.reply = { in_reply_to_tweet_id: replyToId };
      }
      const response = await this.client.v2.tweet(options);
      logger.success(`[postTweetByApi] 投稿成功: ${response.data.id}`);
    } catch (error: unknown) {
      const errObj = error as Record<string, unknown>;
      logger.error(`[postTweetByApi] エラー: ${error instanceof Error ? error.message : String(error)}`);
      if (errObj?.data) {
        logger.error(`[postTweetByApi] レスポンス詳細: ${JSON.stringify(errObj.data).slice(0, 500)}`);
      }
      if (errObj?.errors) {
        logger.error(`[postTweetByApi] エラー詳細: ${JSON.stringify(errObj.errors).slice(0, 500)}`);
      }
      throw error;
    }
  }

  /**
   * twitterapi.io v2 経由でツイート (返信含む)
   * create_tweet_v2 + login_cookies を使用（226エラー回避）
   */
  private async postTweet(
    content: string,
    mediaUrl: string | null,
    replyId: string | null,
    _retried: boolean = false,
  ): Promise<import('axios').AxiosResponse | undefined> {
    if (this.status !== 'running') return;

    // login_cookies が未取得なら自動ログイン
    if (!this.login_cookies) {
      logger.warn('[postTweet] login_cookies が未取得。loginV2 を実行します...');
      await this.loginV2();
    }

    try {
      const endpoint = 'https://api.twitterapi.io/twitter/create_tweet_v2';
      const data: Record<string, unknown> = {
        login_cookies: this.login_cookies,
        tweet_text: content,
        proxy: this.proxy1,
      };
      // Premium プランは長文ツイート対応
      if (!this.isTest && content.length > 280) {
        data.is_note_tweet = true;
      }
      if (replyId) {
        data.reply_to_tweet_id = replyId;
      }
      if (mediaUrl) {
        data.media_ids = [mediaUrl];
      }
      const reqConfig = { headers: { 'X-API-Key': this.apiKey } };
      logger.info(`[postTweet] 投稿中 (v2)... replyId=${replyId}`, 'cyan');
      const response = await axios.post(endpoint, data, reqConfig);
      const resData = response.data;
      logger.info(`[postTweet] レスポンス: ${JSON.stringify(resData).slice(0, 200)}`, 'cyan');

      // --- エラー判定 ---
      // v2 形式: { status: 'error', message/msg: '...' }
      if (resData?.status === 'error') {
        const errMsg = resData?.message || resData?.msg || 'Unknown error';
        const errLower = errMsg.toLowerCase();

        // Note Tweet: twitterapi.io が tweet_id をパースできないが投稿自体は成功している
        if (errLower.includes('could not extract tweet_id')) {
          logger.warn(`[postTweet] Note Tweet投稿: tweet_id取得失敗（投稿自体は成功の可能性あり）`);
          return response;
        }

        logger.error(`[postTweet] APIエラー: ${errMsg}`);

        // セッション切れ → 再ログインしてリトライ（1回のみ）
        if (!_retried && (errLower.includes('cookie') || errLower.includes('login') || errLower.includes('auth'))) {
          logger.warn('[postTweet] セッション無効の可能性。再ログインしてリトライします...');
          await this.loginV2();
          return this.postTweet(content, mediaUrl, replyId, true);
        }
        throw new Error(`Twitter API error: ${errMsg}`);
      }

      // GraphQL 形式のエラー（v1からの互換性チェック）
      if (resData?.errors && Array.isArray(resData.errors) && resData.errors.length > 0) {
        const err = resData.errors[0];
        const errCode = err?.code ?? err?.extensions?.code;
        const errMsg = err?.message || err?.kind || 'Unknown';
        logger.error(`[postTweet] APIエラー: code=${errCode} ${errMsg}`);
        throw new Error(`Twitter API error: code=${errCode} - ${errMsg}`);
      }

      // --- 成功判定 ---
      const tweetId = resData?.tweet_id;
      if (tweetId) {
        logger.success(`[postTweet] 成功: tweet_id=${tweetId}`);
      } else if (resData?.status === 'success') {
        logger.success(`[postTweet] 成功（tweet_idなし）`);
      } else {
        logger.warn(`[postTweet] 成功判定不明: ${JSON.stringify(resData).slice(0, 300)}`);
      }
      return response;
    } catch (error: unknown) {
      logger.error(`[postTweet] エラー: ${error instanceof Error ? error.message : String(error)}`);
      if (isAxiosError(error)) {
        logger.error(`[postTweet] レスポンス: ${JSON.stringify(error.response?.data).slice(0, 300)}`);
      }
      throw error;
    }
  }

  /**
   * twitterapi.io v2 経由でメディアをアップロードし media_id を返す
   * upload_media_v2 エンドポイント使用
   */
  public async uploadMedia(imageBuffer: Buffer, filename: string = 'image.png', isRetry: boolean = false): Promise<string | null> {
    if (!this.login_cookies) {
      logger.warn('[uploadMedia] login_cookies が未取得。loginV2 を実行します...');
      await this.loginV2();
    }

    try {
      const FormData = (await import('form-data')).default;
      const form = new FormData();
      form.append('file', imageBuffer, { filename, contentType: 'image/png' });
      form.append('login_cookies', this.login_cookies);
      form.append('proxy', this.proxy1);

      const endpoint = 'https://api.twitterapi.io/twitter/upload_media_v2';
      logger.info(`[uploadMedia] アップロード中... (${(imageBuffer.length / 1024).toFixed(1)} KB)${isRetry ? ' [リトライ]' : ''}`, 'cyan');

      const response = await axios.post(endpoint, form, {
        headers: {
          ...form.getHeaders(),
          'X-API-Key': this.apiKey,
        },
        maxContentLength: 10 * 1024 * 1024,
        maxBodyLength: 10 * 1024 * 1024,
      });

      const resData = response.data;
      if (resData?.status === 'success' && resData?.media_id) {
        logger.info(`[uploadMedia] 成功: media_id=${resData.media_id}`, 'green');
        return resData.media_id;
      }

      const errDetail = resData?.msg || resData?.message || JSON.stringify(resData).slice(0, 200);
      logger.error(`[uploadMedia] エラー: ${errDetail}`);

      if (!isRetry) {
        logger.warn('[uploadMedia] セッション無効の可能性。再ログインしてリトライします...');
        await this.loginV2();
        return this.uploadMedia(imageBuffer, filename, true);
      }
      return null;
    } catch (error: unknown) {
      const errMsg = isAxiosError(error)
        ? error.response?.data?.message || error.message
        : error instanceof Error ? error.message : String(error);
      logger.error(`[uploadMedia] 失敗: ${errMsg}`);

      if (!isRetry) {
        logger.warn('[uploadMedia] 再ログインしてリトライします...');
        try {
          await this.loginV2();
          return this.uploadMedia(imageBuffer, filename, true);
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  /**
   * twitterapi.io v2 経由で引用リツイート
   * Twitterの仕様: ツイートURLをテキスト末尾に付加することで引用RTとして認識される
   * (attachment_url パラメータは引用RTとして機能しないため使用しない)
   */
  private async postQuoteTweet(content: string, quoteTweetUrl: string) {
    if (this.status !== 'running') return;
    try {
      const endpoint = 'https://api.twitterapi.io/twitter/create_tweet_v2';
      // URLをテキスト末尾に追加（Twitterが引用RTとして認識する）
      const tweetText = `${content} ${quoteTweetUrl}`;
      const data = {
        login_cookies: this.login_cookies,
        tweet_text: tweetText,
        proxy: this.proxy1,
      };
      const reqConfig = { headers: { 'X-API-Key': this.apiKey } };
      const response = await axios.post(endpoint, data, reqConfig);
      const resData = response.data;
      logger.debug(`[postQuoteTweet] API response: ${JSON.stringify(resData).slice(0, 300)}`);
      // v2 レスポンス形式: { tweet_id, status, msg }
      if (resData?.status === 'error') {
        const errMsg = resData?.msg || resData?.message || JSON.stringify(resData);
        logger.error(`引用RT投稿失敗: ${errMsg}`);
        throw new Error(`Twitter API error: ${errMsg}`);
      }
      logger.success(`引用RT投稿成功: tweet_id=${resData?.tweet_id ?? 'OK'} text_len=${tweetText.length}`);
      return response;
    } catch (error: unknown) {
      logger.error(`引用RT投稿失敗: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
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

      // 日次返信上限チェック
      if (this.isReplyLimitReached()) {
        logger.info(`📋 [Polling] 日次返信上限に到達。スキップ`, 'yellow');
        return;
      }

      this.incrementReplyCount();
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

        // エラーレスポンスチェック（API がエラーを返す場合は status や message が含まれる）
        if (res.data.status && res.data.status !== 'success') {
          logger.error(`advanced_search エラー: ${JSON.stringify(res.data)}`);
          break;
        }

        // 正常レスポンス: { tweets: [...], has_next_page, next_cursor }
        if (!Array.isArray(res.data.tweets)) {
          logger.error(`advanced_search 予期しないレスポンス形式: ${JSON.stringify(res.data).substring(0, 300)}`);
          break;
        }

        const tweets = res.data.tweets as TweetData[];
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
        logger.debug('📭 新着ツイートなし');
        return;
      }

      logger.info(`📬 ${allTweets.length}件の新着ツイートを検出`, 'green');

      // 各ツイートに対してアクション実行
      for (const tweet of allTweets) {
        // 既に処理済みならスキップ
        if (this.processedTweetIds.has(tweet.id)) continue;
        this.processedTweetIds.add(tweet.id);
        this.saveProcessedIds();

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

        // 3) 確率で返信 (ai_mine_lab 用)
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

        // 4) メンバーFCA: LLMが返信/引用RTを自動判断（メンバーには必ず反応）
        if (accountConfig.memberFCA) {
          const tweetUrl = tweet.url || `https://x.com/${authorUserName}/status/${tweet.id}`;
          let repliedTweetText = '';
          let repliedTweetAuthorName = '';

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
            type: 'llm:respond_member_tweet',
            memoryZone: 'twitter:post',
            data: {
              tweetId: tweet.id,
              tweetUrl,
              text: tweet.text,
              authorName: tweet.author.name,
              authorUserName,
              repliedTweet: repliedTweetText,
              repliedTweetAuthorName,
            } as MemberTweetInput,
          });
        }
      }

      // LRUSet が maxSize=1000 で自動 eviction するため手動トリミング不要
    } catch (e) {
      logger.error('Twitter監視エラー:', e);
    }
  }

  // =========================================================================
  // 自動投稿 (Auto-Post)
  // =========================================================================

  /**
   * twitterapi.io からトレンドデータを取得 (日本: woeid=23424856)
   */
  private async fetchTrends(): Promise<TwitterTrendData[]> {
    try {
      const res = await axios.get(
        'https://api.twitterapi.io/twitter/trends',
        {
          headers: { 'X-API-Key': this.apiKey },
          params: { woeid: '23424856' },
        }
      );

      if (res.data?.trends && Array.isArray(res.data.trends)) {
        return res.data.trends.map((t: any, i: number) => {
          // API v2: { trend: { name, target: { query }, rank } }
          const trend = t.trend && typeof t.trend === 'object' ? t.trend : t;
          return {
            name: trend.name ?? '',
            query: trend.target?.query ?? trend.query ?? trend.name ?? '',
            rank: trend.rank ?? i + 1,
            metaDescription: trend.meta_description ?? trend.metaDescription ?? undefined,
          };
        });
      }

      logger.warn('🐦 fetchTrends: 予期しないレスポンス形式');
      return [];
    } catch (error) {
      logger.error('🐦 fetchTrends エラー:', error);
      return [];
    }
  }

  /**
   * 現在JSTの時間 (0-23) を返す
   */
  private getJSTHour(): number {
    const now = new Date();
    const jstNow = toZonedTime(now, 'Asia/Tokyo');
    return jstNow.getHours();
  }

  /**
   * 今日の日付情報を組み立てる
   */
  private getTodayInfo(): string {
    const now = new Date();
    const jstNow = toZonedTime(now, 'Asia/Tokyo');
    const dateStr = format(jstNow, 'yyyy年M月d日(E)', { locale: undefined });
    const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][jstNow.getDay()];
    const month = jstNow.getMonth() + 1;
    const day = jstNow.getDate();

    const lines = [`今日: ${jstNow.getFullYear()}年${month}月${day}日(${dayOfWeek})`];

    // 季節イベントのヒント
    if (month === 1 && day === 1) lines.push('イベント: 元旦');
    else if (month === 2 && day === 3) lines.push('イベント: 節分');
    else if (month === 2 && day === 14) lines.push('イベント: バレンタインデー');
    else if (month === 3 && day === 3) lines.push('イベント: ひな祭り');
    else if (month === 3 && day === 14) lines.push('イベント: ホワイトデー');
    else if (month === 4 && day >= 1 && day <= 10) lines.push('季節: 桜の季節');
    else if (month === 5 && day === 5) lines.push('イベント: こどもの日');
    else if (month === 7 && day === 7) lines.push('イベント: 七夕');
    else if (month === 8 && day >= 13 && day <= 16) lines.push('イベント: お盆');
    else if (month === 10 && day === 31) lines.push('イベント: ハロウィン');
    else if (month === 12 && day === 24) lines.push('イベント: クリスマスイブ');
    else if (month === 12 && day === 25) lines.push('イベント: クリスマス');
    else if (month === 12 && day === 31) lines.push('イベント: 大晦日');

    return lines.join('\n');
  }

  /**
   * 自動投稿を実行する
   */
  private async autoPostTweet(): Promise<void> {
    if (this.status !== 'running') {
      logger.info('🐦 AutoPost: Twitter未起動、スキップ');
      this.scheduleFromDailyPlan();
      return;
    }

    try {
      const mode = this.selectAutoTweetMode();

      let trends: TwitterTrendData[] = [];
      if (mode === 'trend') {
        logger.info(`🐦 AutoPost: トレンド取得中...`, 'cyan');
        trends = await this.fetchTrends();
        if (trends.length === 0) {
          logger.warn('🐦 AutoPost: トレンド取得失敗、スキップ');
          this.scheduleFromDailyPlan();
          return;
        }
      }

      const todayInfo = this.getTodayInfo();

      logger.info(
        `🐦 AutoPost: LLMにツイート生成をリクエスト (mode=${mode}, トレンド${trends.length}件)`,
        'cyan'
      );

      this.eventBus.publish({
        type: 'llm:generate_auto_tweet',
        memoryZone: 'twitter:post',
        data: {
          mode,
          trends,
          todayInfo,
          recentPosts: [...this.recentAutoPosts],
          recentQuoteUrls: [...this.recentQuoteUrls],
          recentTopics: [...this.recentTopics],
        } as TwitterAutoTweetInput,
      });

      this.autoPostCount++;
      this.lastAutoPostAt = Date.now();
      this.saveAutoPostCount();
      logger.info(
        `🐦 AutoPost: リクエスト送信完了 (本日 ${this.autoPostCount}/${this.todayPostTimes.length}件予定)`,
        'green'
      );
    } catch (error) {
      logger.error('🐦 AutoPost エラー:', error);
    }

    // 次回をスケジュール
    this.scheduleFromDailyPlan();
  }

  /**
   * 当日の投稿スケジュールをファイルから読み込む。
   * 今日の分がなければ新規生成する。
   */
  private loadDailySchedule(): void {
    try {
      if (fs.existsSync(DAILY_SCHEDULE_FILE)) {
        const data = JSON.parse(fs.readFileSync(DAILY_SCHEDULE_FILE, 'utf-8'));
        if (data.date === this.getTodayJST()) {
          this.todayPostTimes = data.times || [];
          if (typeof data.postedCount === 'number') {
            this.autoPostCount = data.postedCount;
          }
          logger.info(
            `📋 投稿スケジュール読み込み: ${this.todayPostTimes.length}件 (${data.date}), 投稿済み: ${this.autoPostCount}件`,
            'cyan'
          );
          this.logDailySchedule();
          return;
        }
      }
    } catch (err) {
      logger.warn(`📋 投稿スケジュール読み込み失敗: ${err}`);
    }
    this.generateDailySchedule();
  }

  /**
   * 当日分の投稿予定時刻をランダム生成してファイルに保存する。
   * 件数は minAutoPostsPerDay ～ maxAutoPostsPerDay のランダム値。
   */
  private generateDailySchedule(): void {
    const count =
      Math.floor(
        Math.random() * (this.maxAutoPostsPerDay - this.minAutoPostsPerDay + 1)
      ) + this.minAutoPostsPerDay;

    const jstNow = toZonedTime(new Date(), 'Asia/Tokyo');

    // 活動開始時刻 (JST startHour:00)
    const startJST = new Date(jstNow);
    startJST.setHours(this.autoPostStartHour, 0, 0, 0);
    const startMs = startJST.getTime();

    // 活動終了時刻 (JST endHour:00、24 なら翌 0:00)
    const endJST = new Date(jstNow);
    if (this.autoPostEndHour >= 24) {
      endJST.setDate(endJST.getDate() + 1);
      endJST.setHours(0, 0, 0, 0);
    } else {
      endJST.setHours(this.autoPostEndHour, 0, 0, 0);
    }
    const endMs = endJST.getTime();
    const range = endMs - startMs;

    const times: number[] = [];
    for (let i = 0; i < count; i++) {
      times.push(Math.floor(startMs + Math.random() * range));
    }
    times.sort((a, b) => a - b);

    this.todayPostTimes = times;
    this.saveDailySchedule();

    logger.info(
      `📋 投稿スケジュール生成: ${count}件 (${this.getTodayJST()})`,
      'green'
    );
    this.logDailySchedule();
  }

  /** スケジュールをファイルに保存（投稿済みカウントも含む） */
  private saveDailySchedule(): void {
    try {
      const dir = path.dirname(DAILY_SCHEDULE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        DAILY_SCHEDULE_FILE,
        JSON.stringify(
          {
            date: this.getTodayJST(),
            times: this.todayPostTimes,
            postedCount: this.autoPostCount,
          },
          null,
          2
        )
      );
    } catch (err) {
      logger.warn(`📋 投稿スケジュール保存失敗: ${err}`);
    }
  }

  /** スケジュール一覧をログ出力 */
  private logDailySchedule(): void {
    const now = Date.now();
    this.todayPostTimes.forEach((t, i) => {
      const jst = toZonedTime(new Date(t), 'Asia/Tokyo');
      const timeStr = format(jst, 'HH:mm');
      const status = t <= now ? '✅済' : '⏳予定';
      logger.info(`  ${i + 1}. ${timeStr} ${status}`, 'cyan');
    });
  }

  /**
   * 今日のスケジュールから次回投稿時刻を探してタイマーをセットする。
   * 過去の時刻はスキップし、すべて過ぎていたら終了。
   */
  private scheduleFromDailyPlan(): void {
    if (this.autoPostTimer) {
      clearTimeout(this.autoPostTimer);
      this.autoPostTimer = null;
    }

    const now = Date.now();
    const nextTime = this.todayPostTimes.find((t) => t > now);

    if (!nextTime) {
      logger.info('🐦 AutoPost: 本日のスケジュールをすべて消化。翌日まで待機', 'cyan');
      return;
    }

    const delay = nextTime - now;
    const nextJST = toZonedTime(new Date(nextTime), 'Asia/Tokyo');
    logger.info(
      `🐦 AutoPost: 次回投稿 ${format(nextJST, 'HH:mm')} (${Math.round(delay / 60000)}分後)`,
      'cyan'
    );

    this.autoPostTimer = setTimeout(() => this.autoPostTweet(), delay);
  }

  /**
   * 毎日 0:00 JST に自動投稿カウンターをリセットし、翌日のスケジュールを生成する
   */
  private scheduleDailyReset(): void {
    const scheduleNext = () => {
      const now = new Date();
      const jstNow = toZonedTime(now, 'Asia/Tokyo');

      const nextMidnight = new Date(jstNow);
      nextMidnight.setDate(nextMidnight.getDate() + 1);
      nextMidnight.setHours(0, 0, 0, 0);

      const msUntilMidnight = nextMidnight.getTime() - jstNow.getTime();

      logger.info(
        `🐦 AutoPost: 日次リセットを ${Math.round(msUntilMidnight / 60000)}分後にスケジュール`,
        'cyan'
      );

      this.dailyResetTimer = setTimeout(() => {
        // カウンタリセット
        this.autoPostCount = 0;
        this.autoPostDate = this.getTodayJST();
        this.lastAutoPostAt = 0;
        this.saveAutoPostCount();
        // 翌日スケジュール生成 & タイマーセット
        this.generateDailySchedule();
        this.scheduleFromDailyPlan();
        logger.info('🐦 AutoPost: 日次リセット完了。新しいスケジュールで再開', 'green');
        // 翌日のリセットもスケジュール
        scheduleNext();
      }, msUntilMidnight);
    };

    scheduleNext();
  }

  // =========================================================================
  // Webhook ルール管理
  // =========================================================================

  /** 現在のWebhookルールID (起動中のみ保持) */
  private webhookRuleId: string | null = null;
  /** 引用RT検知用WebhookルールID */
  private quoteRTWebhookRuleId: string | null = null;


  /**
   * twitterapi.io の Webhook フィルタルールをセットアップし有効化する。
   * - 既存ルール (タグ一致) があればそれを再利用 & 有効化
   * - なければ新規作成 & 有効化
   */
  public async setupWebhookRule(): Promise<void> {
    const baseUrl = config.twitter.webhookBaseUrl;
    const userName = config.twitter.userName;
    if (!baseUrl || !userName) {
      logger.warn('🔔 Webhook: webhookBaseUrl または userName が未設定。スキップ');
      return;
    }

    const tag = `shannon-reply-${this.isTest ? 'dev' : 'prod'}`;
    const filterValue = `to:${userName}`;
    const interval = config.twitter.webhookInterval;

    try {
      // 1. 既存ルールを取得
      const rulesRes = await axios.get(
        'https://api.twitterapi.io/oapi/tweet_filter/get_rules',
        { headers: { 'X-API-Key': this.apiKey } }
      );

      const existingRules: Array<{
        rule_id: string;
        tag: string;
        value: string;
        interval_seconds: number;
        is_effect?: number;
      }> = rulesRes.data?.rules ?? [];

      const existing = existingRules.find((r) => r.tag === tag);

      if (existing) {
        this.webhookRuleId = existing.rule_id;
        const alreadyActive = existing.is_effect === 1;
        logger.info(
          `🔔 Webhook: 既存ルールを再利用 (id=${existing.rule_id}, tag=${tag}, active=${alreadyActive})`,
          'cyan'
        );
        // 既に有効なら update_rule を呼ばない (カーソルリセット防止)
        if (alreadyActive) {
          logger.info(
            `🔔 Webhook: ルールは既に有効。再有効化スキップ (interval=${interval}秒, filter="${filterValue}")`,
            'green'
          );
          return;
        }
      } else {
        // 2. 新規ルール作成
        const addRes = await axios.post(
          'https://api.twitterapi.io/oapi/tweet_filter/add_rule',
          { tag, value: filterValue, interval_seconds: interval },
          { headers: { 'X-API-Key': this.apiKey } }
        );

        if (addRes.data?.status !== 'success') {
          logger.error(`🔔 Webhook: ルール作成失敗: ${addRes.data?.msg}`);
          return;
        }

        this.webhookRuleId = addRes.data.rule_id;
        logger.info(
          `🔔 Webhook: 新規ルール作成 (id=${this.webhookRuleId}, tag=${tag}, filter="${filterValue}")`,
          'green'
        );
      }

      // 3. ルールを有効化
      const updateRes = await axios.post(
        'https://api.twitterapi.io/oapi/tweet_filter/update_rule',
        {
          rule_id: this.webhookRuleId,
          tag,
          value: filterValue,
          interval_seconds: interval,
          is_effect: 1,
        },
        { headers: { 'X-API-Key': this.apiKey } }
      );

      if (updateRes.data?.status === 'success') {
        logger.info(
          `🔔 Webhook: ルール有効化完了 (interval=${interval}秒, filter="${filterValue}")`,
          'green'
        );
      } else {
        logger.error(`🔔 Webhook: ルール有効化失敗: ${updateRes.data?.msg}`);
      }
    } catch (error) {
      logger.error('🔔 Webhook: セットアップエラー:', error);
    }
  }

  /**
   * twitterapi.io の Webhook フィルタルールを無効化する (is_effect: 0)。
   * ルール自体は削除しない (再起動時に再利用)。
   */
  public async deactivateWebhookRule(): Promise<void> {
    if (!this.webhookRuleId) {
      return;
    }

    const tag = `shannon-reply-${this.isTest ? 'dev' : 'prod'}`;
    const userName = config.twitter.userName;
    const filterValue = userName ? `to:${userName}` : '';
    const interval = config.twitter.webhookInterval;

    try {
      const res = await axios.post(
        'https://api.twitterapi.io/oapi/tweet_filter/update_rule',
        {
          rule_id: this.webhookRuleId,
          tag,
          value: filterValue,
          interval_seconds: interval,
          is_effect: 0,
        },
        { headers: { 'X-API-Key': this.apiKey } }
      );

      if (res.data?.status === 'success') {
        logger.info('🔔 Webhook: ルール無効化完了', 'green');
      } else {
        logger.error(`🔔 Webhook: ルール無効化失敗: ${res.data?.msg}`);
      }
    } catch (error) {
      logger.error('🔔 Webhook: 無効化エラー:', error);
    }
  }

  // =========================================================================
  // 引用RT検知用 Webhook ルール
  // =========================================================================

  /**
   * 自分のツイートが引用RTされた時に検知する Webhook ルールをセットアップ。
   * フィルタ: url:"x.com/USERNAME/status" -from:USERNAME
   */
  public async setupQuoteRTWebhookRule(): Promise<void> {
    const baseUrl = config.twitter.webhookBaseUrl;
    const userName = config.twitter.userName;
    if (!baseUrl || !userName) {
      logger.warn('🔔 QuoteRT Webhook: webhookBaseUrl または userName が未設定。スキップ');
      return;
    }

    const tag = `shannon-quote-rt-${this.isTest ? 'dev' : 'prod'}`;
    const filterValue = `url:"x.com/${userName}/status" -from:${userName}`;
    const interval = config.twitter.webhookInterval;

    try {
      const rulesRes = await axios.get(
        'https://api.twitterapi.io/oapi/tweet_filter/get_rules',
        { headers: { 'X-API-Key': this.apiKey } }
      );

      const existingRules: Array<{
        rule_id: string;
        tag: string;
        value: string;
        interval_seconds: number;
        is_effect?: number;
      }> = rulesRes.data?.rules ?? [];

      const existing = existingRules.find((r) => r.tag === tag);

      if (existing) {
        this.quoteRTWebhookRuleId = existing.rule_id;
        const alreadyActive = existing.is_effect === 1;
        logger.info(
          `🔔 QuoteRT Webhook: 既存ルールを再利用 (id=${existing.rule_id}, tag=${tag}, active=${alreadyActive})`,
          'cyan'
        );
        if (alreadyActive) {
          logger.info(
            `🔔 QuoteRT Webhook: ルールは既に有効。スキップ (filter="${filterValue}")`,
            'green'
          );
          return;
        }
      } else {
        const addRes = await axios.post(
          'https://api.twitterapi.io/oapi/tweet_filter/add_rule',
          { tag, value: filterValue, interval_seconds: interval },
          { headers: { 'X-API-Key': this.apiKey } }
        );

        if (addRes.data?.status !== 'success') {
          logger.error(`🔔 QuoteRT Webhook: ルール作成失敗: ${addRes.data?.msg}`);
          return;
        }

        this.quoteRTWebhookRuleId = addRes.data.rule_id;
        logger.info(
          `🔔 QuoteRT Webhook: 新規ルール作成 (id=${this.quoteRTWebhookRuleId}, tag=${tag}, filter="${filterValue}")`,
          'green'
        );
      }

      const updateRes = await axios.post(
        'https://api.twitterapi.io/oapi/tweet_filter/update_rule',
        {
          rule_id: this.quoteRTWebhookRuleId,
          tag,
          value: filterValue,
          interval_seconds: interval,
          is_effect: 1,
        },
        { headers: { 'X-API-Key': this.apiKey } }
      );

      if (updateRes.data?.status === 'success') {
        logger.info(
          `🔔 QuoteRT Webhook: ルール有効化完了 (filter="${filterValue}")`,
          'green'
        );
      } else {
        logger.error(`🔔 QuoteRT Webhook: ルール有効化失敗: ${updateRes.data?.msg}`);
      }
    } catch (error) {
      logger.error('🔔 QuoteRT Webhook: セットアップエラー:', error);
    }
  }

  // =========================================================================
  // Initialization
  // =========================================================================

  public async initialize() {
    try {
      // V2 ログイン: まずファイルから login_cookies を復元、なければ新規ログイン
      let cookiesRestored = false;
      try {
        if (fs.existsSync(LOGIN_COOKIES_FILE)) {
          const saved = JSON.parse(fs.readFileSync(LOGIN_COOKIES_FILE, 'utf-8'));
          if (saved?.cookies && typeof saved.cookies === 'string' && saved.cookies.length > 100) {
            this.login_cookies = saved.cookies;
            cookiesRestored = true;
            logger.success(`[initialize] login_cookies をファイルから復元 (${saved.cookies.length}文字, saved: ${saved.updatedAt ?? '不明'})`);
          }
        }
      } catch (e) {
        logger.warn(`[initialize] login_cookies ファイル読込失敗: ${e}`);
      }
      if (!cookiesRestored) {
        try {
          await this.loginV2();
        } catch (loginError) {
          logger.warn(`[initialize] V2ログイン失敗（投稿時に再試行します）: ${loginError instanceof Error ? loginError.message : String(loginError)}`);
        }
      }

      // Webhook ルールをセットアップ (dev/prod 共通)
      await this.setupWebhookRule();
      // 引用RT検知用 Webhook ルール
      await this.setupQuoteRTWebhookRule();

      if (!this.isTest) {
        // リプライ検知: Webhook がメイン。ポーリングはフォールバック (2時間間隔)
        setInterval(() => this.checkRepliesAndRespond(), 2 * 60 * 60 * 1000);

        // 統合監視: 全アカウントの新着ツイートを一括チェック
        setInterval(
          () => this.autoMonitorAccounts(),
          this.monitorIntervalMs
        );

        // 初回実行
        this.autoMonitorAccounts();
      }

      // 自動投稿カウンタをファイルから復元
      this.loadAutoPostCount();

      // 当日の投稿スケジュールをファイルから復元（なければ新規生成）
      this.loadDailySchedule();

      // 自動投稿スケジューラ起動 (dev/test モードでもテスト可能)
      this.scheduleDailyReset();
      logger.info(
        `🐦 AutoPost: 初期化完了 (${this.minAutoPostsPerDay}-${this.maxAutoPostsPerDay}/日, ${this.autoPostStartHour}時-${this.autoPostEndHour}時 JST, 本日${this.todayPostTimes.length}件予定・${this.autoPostCount}件投稿済み)`,
        'green'
      );

      // スケジュール済み時刻から次回タイマーをセット
      this.scheduleFromDailyPlan();
      this.setupEventHandlers();
    } catch (error) {
      logger.error(`Twitter initialization error: ${error}`);
      throw error;
    }
  }

  /**
   * Rate Limit 対応の API 呼び出しラッパー。
   * 429 エラー時に指数バックオフでリトライする。
   */
  public async callWithRetry<T>(fn: () => Promise<T>, label = 'Twitter API'): Promise<T> {
    return retryWithBackoff(fn, { maxRetries: 3, label });
  }
}

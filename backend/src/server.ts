import express from 'express';
import http from 'http';
import path from 'path';
import mongoose from 'mongoose';
import { TwitterReplyOutput } from '@shannon/common';
import { PORTS } from './config/ports.js';
import { config } from './config/env.js';
import { DiscordBot } from './services/discord/client.js';
import { getEventBus } from './services/eventBus/index.js';
import { LLMService } from './services/llm/client.js';
import { MinebotClient } from './services/minebot/client.js';
import { MinecraftClient } from './services/minecraft/client.js';
import { NotionClient } from './services/notion/client.js';
import { Scheduler } from './services/scheduler/client.js';
import { TwitterClient } from './services/twitter/client.js';
import { WebClient } from './services/web/client.js';
import { YoutubeClient } from './services/youtube/client.js';
import { logger, initFileLogging } from './utils/logger.js';

class Server {
  private llmService: LLMService;
  private discordBot: DiscordBot;
  private webClient: WebClient;
  private twitterClient: TwitterClient;
  private scheduler: Scheduler;
  private youtubeClient: YoutubeClient;
  private minecraftClient: MinecraftClient;
  private minebotClient: MinebotClient;
  private notionClient: NotionClient;
  private httpServer: http.Server | null = null;

  constructor() {
    const isDevMode = process.argv.includes('--dev');
    this.llmService = LLMService.getInstance(isDevMode);
    this.discordBot = DiscordBot.getInstance(isDevMode);
    // WebClientは環境変数で正しいポートを設定しているので、isTestはfalse
    this.webClient = WebClient.getInstance(false);
    this.twitterClient = TwitterClient.getInstance(isDevMode);
    this.scheduler = Scheduler.getInstance(isDevMode);
    this.youtubeClient = YoutubeClient.getInstance(isDevMode);
    this.minecraftClient = MinecraftClient.getInstance(isDevMode);
    this.minebotClient = MinebotClient.getInstance(isDevMode);
    this.notionClient = NotionClient.getInstance(isDevMode);
  }

  private startHTTPServer() {
    const app = express();
    app.use(express.json());

    app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // -----------------------------------------------------------------
    // Twitter Webhook: twitterapi.io からのリアルタイム返信通知を受信
    // -----------------------------------------------------------------

    // GET: twitterapi.io が Webhook URL 保存時に検証リクエストを送る
    app.get('/api/webhook/twitter', (_req, res) => {
      res.status(200).json({ ok: true });
    });

    // POST: 定期投稿テスト (生成 → Twitter実投稿)
    // body: { command: 'fortune' | 'forecast' | 'about_today' | 'news_today' }
    // query: ?dry_run=true で投稿せずに生成結果のみ返す
    app.post('/api/test/scheduled-post', async (req, res) => {
      const key = req.headers['x-api-key'] as string | undefined;
      if (!key || key !== config.twitter.twitterApiIoKey) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const command = (req.body as any)?.command as string | undefined;
      const dryRun = req.query.dry_run === 'true';
      const validCommands = ['fortune', 'forecast', 'about_today', 'news_today'];
      if (!command || !validCommands.includes(command)) {
        res.status(400).json({ error: `command must be one of: ${validCommands.join(', ')}` });
        return;
      }
      try {
        let post = '';
        let imagePrompt: string | undefined;

        if (command === 'fortune') {
          const { PostFortuneAgent } = await import('./services/llm/agents/postFortuneAgent.js');
          const agent = await PostFortuneAgent.create();
          const result = await agent.createPost();
          post = result.text;
          imagePrompt = result.imagePrompt;
        } else if (command === 'forecast') {
          const { PostWeatherAgent } = await import('./services/llm/agents/postWeatherAgent.js');
          const agent = await PostWeatherAgent.create();
          const result = await agent.createPost();
          post = result.text;
          imagePrompt = result.imagePrompt;
        } else if (command === 'about_today') {
          const { PostAboutTodayAgent } = await import('./services/llm/agents/postAboutTodayAgent.js');
          const agent = await PostAboutTodayAgent.create();
          const result = await agent.createPost();
          post = result.text;
          imagePrompt = result.imagePrompt;
        } else if (command === 'news_today') {
          const { PostNewsAgent } = await import('./services/llm/agents/postNewsAgent.js');
          const agent = await PostNewsAgent.create();
          const result = await agent.createPost();
          post = result.text;
          imagePrompt = result.imagePrompt;
        }
        logger.info(`[Test:ScheduledPost] ${command} 生成完了: ${post.slice(0, 100)}...`);

        // 画像生成 + アップロード（全 command 共通、dry_run でなければ）
        let mediaId: string | null = null;
        if (!dryRun && imagePrompt) {
          try {
            const { generateImage } = await import('./services/llm/utils/generateImage.js');
            const imgBuf = await generateImage(imagePrompt, '1024x1024', 'low');
            if (imgBuf) {
              const { TwitterClient } = await import('./services/twitter/client.js');
              const twitterClient = TwitterClient.getInstance();
              mediaId = await twitterClient.uploadMedia(imgBuf, `${command}.jpg`) ?? null;
              if (mediaId) {
                logger.info(`[Test:ScheduledPost] ${command} 画像アップロード成功: ${mediaId}`);
              }
            }
          } catch (imgErr) {
            logger.warn(`[Test:ScheduledPost] ${command} 画像失敗（テキストのみ）: ${imgErr}`);
          }
        }

        if (!dryRun && post) {
          const eventBus = getEventBus();
          eventBus.publish({
            type: 'twitter:post_scheduled_message',
            memoryZone: 'twitter:schedule_post',
            data: {
              text: post,
              ...(mediaId ? { imageUrl: mediaId } : {}),
            } as any,
          });
          logger.info(`[Test:ScheduledPost] ${command} Twitter投稿イベント発行${mediaId ? ' (画像付き)' : ''}`);
        }
        res.status(200).json({
          ok: true,
          command,
          tweet: post,
          posted: !dryRun,
          ...(dryRun && imagePrompt ? { imagePrompt } : {}),
          ...(mediaId ? { mediaId } : {}),
        });
      } catch (err) {
        logger.error(`[Test:ScheduledPost] ${command} エラー`, err);
        res.status(500).json({ error: String(err) });
      }
    });

    // POST: トレンドベース自動ツイートテスト (生成 → Twitter実投稿)
    // query: ?dry_run=true で投稿せずに生成結果のみ返す
    app.post('/api/test/auto-tweet', async (req, res) => {
      const key = req.headers['x-api-key'] as string | undefined;
      if (!key || key !== config.twitter.twitterApiIoKey) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const dryRun = req.query.dry_run === 'true';
      try {
        const axios = (await import('axios')).default;
        const { AutoTweetAgent } = await import('./services/llm/agents/autoTweetAgent.js');
        const agent = await AutoTweetAgent.create();

        const trendsRes = await axios.get('https://api.twitterapi.io/twitter/trends', {
          headers: { 'X-API-Key': config.twitter.twitterApiIoKey },
          params: { woeid: '23424856' },
        });
        const trends = (trendsRes.data?.trends ?? []).map((t: any, i: number) => {
          const trend = t.trend && typeof t.trend === 'object' ? t.trend : t;
          return {
            name: trend.name ?? '',
            query: trend.target?.query ?? trend.query ?? trend.name ?? '',
            rank: trend.rank ?? i + 1,
            metaDescription: trend.meta_description ?? trend.metaDescription ?? undefined,
          };
        });

        const now = new Date();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][now.getDay()];
        const todayInfo = `今日: ${now.getFullYear()}年${month}月${day}日(${dayOfWeek})`;

        // recent_auto_posts.json から直近投稿を読み込む
        let recentPosts: string[] = [];
        try {
          const fs = await import('fs');
          const recentPostsPath = path.resolve('saves/recent_auto_posts.json');
          if (fs.existsSync(recentPostsPath)) {
            recentPosts = JSON.parse(fs.readFileSync(recentPostsPath, 'utf-8'));
          }
        } catch {
          // ファイルが存在しない or 読み込み失敗は無視
        }

        logger.info(`[Test:AutoTweet] トレンド ${trends.length}件・直近投稿 ${recentPosts.length}件で生成開始`);
        const result = await agent.generateTweet(trends, todayInfo, recentPosts);
        logger.info(`[Test:AutoTweet] 生成結果: ${JSON.stringify(result)}`);

        if (!dryRun && result) {
          const eventBus = getEventBus();
          eventBus.publish({
            type: 'twitter:post_scheduled_message',
            memoryZone: 'twitter:post',
            data: {
              text: result.text,
              ...(result.type === 'quote_rt' && result.quoteUrl
                ? { quoteTweetUrl: result.quoteUrl }
                : {}),
            } as any,
          });
          logger.info(`[Test:AutoTweet] Twitter投稿イベント発行 (type=${result.type})`);
        }
        res.status(200).json({
          ok: true,
          result,
          trendsUsed: trends.length,
          recentPostsLoaded: recentPosts.length,
          recentPosts: recentPosts.slice(-10),
          posted: !dryRun && !!result,
        });
      } catch (err) {
        logger.error('[Test:AutoTweet] エラー', err);
        res.status(500).json({ error: String(err) });
      }
    });

    // POST: メンバーTweetへの返信テスト (ライ・ヤミーなどのツイートに反応)
    // body: { tweetUrl?: string }  省略時はライの最新ツイートを自動取得
    // query: ?dry_run=true で投稿せずに生成結果のみ返す
    app.post('/api/test/member-tweet', async (req, res) => {
      const key = req.headers['x-api-key'] as string | undefined;
      if (!key || key !== config.twitter.twitterApiIoKey) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const dryRun = req.query.dry_run === 'true';
      const inputTweetUrl = (req.body as any)?.tweetUrl as string | undefined;
      try {
        const axios = (await import('axios')).default;
        const { MemberTweetAgent } = await import('./services/llm/agents/memberTweetAgent.js');
        const agent = await MemberTweetAgent.create();

        // tweetUrl が指定されていればそのツイートを取得、なければライの最新ツイートを取得
        let tweetId: string;
        let tweetText: string;
        let authorName: string;
        let authorUserName: string;
        let tweetUrl: string;

        if (inputTweetUrl) {
          // URL から tweetId を抽出
          const match = inputTweetUrl.match(/\/status\/(\d+)/);
          if (!match) {
            res.status(400).json({ error: 'tweetUrl の形式が不正です (例: https://x.com/user/status/ID)' });
            return;
          }
          tweetId = match[1];
          const detailRes = await axios.get('https://api.twitterapi.io/twitter/tweet/detail', {
            headers: { 'X-API-Key': config.twitter.twitterApiIoKey },
            params: { tweetId },
          });
          const t = detailRes.data?.tweet || detailRes.data?.tweets?.[0];
          if (!t) {
            res.status(404).json({ error: `ツイート ${tweetId} が見つかりません` });
            return;
          }
          tweetText = t.text ?? '';
          authorName = t.author?.name ?? '';
          authorUserName = t.author?.userName ?? '';
          tweetUrl = t.url || inputTweetUrl;
        } else {
          // ライの最新ツイートを自動取得
          const raiUserName = config.twitter.usernames?.rai || 'RaiDr_';
          const tweetsRes = await axios.get('https://api.twitterapi.io/twitter/user/tweets', {
            headers: { 'X-API-Key': config.twitter.twitterApiIoKey },
            params: { userName: raiUserName, count: 1 },
          });
          const tweets = tweetsRes.data?.tweets ?? tweetsRes.data?.data?.tweets ?? [];
          if (tweets.length === 0) {
            res.status(404).json({ error: `@${raiUserName} のツイートが見つかりません` });
            return;
          }
          const t = tweets[0];
          tweetId = t.id;
          tweetText = t.text ?? '';
          authorName = t.author?.name ?? '';
          authorUserName = t.author?.userName ?? '';
          tweetUrl = t.url || `https://x.com/${authorUserName}/status/${tweetId}`;
        }

        logger.info(`[Test:MemberTweet] 対象: @${authorUserName} "${tweetText.slice(0, 60)}" (id=${tweetId})`);

        const result = await agent.respond({
          text: tweetText,
          authorName,
          authorUserName,
          repliedTweet: '',
          repliedTweetAuthorName: '',
        });

        logger.info(`[Test:MemberTweet] 生成結果: ${JSON.stringify(result)}`);

        if (!dryRun && result) {
          const eventBus = getEventBus();
          if (result.type === 'quote_rt') {
            eventBus.publish({
              type: 'twitter:post_message',
              memoryZone: 'twitter:post',
              data: { text: result.text, quoteTweetUrl: tweetUrl } as any,
            });
          } else {
            eventBus.publish({
              type: 'twitter:post_message',
              memoryZone: 'twitter:post',
              data: { text: result.text, replyId: tweetId } as any,
            });
          }
          logger.info(`[Test:MemberTweet] Twitter投稿イベント発行 (type=${result.type})`);
        }

        res.status(200).json({
          ok: true,
          result,
          sourceTweet: { tweetId, tweetUrl, text: tweetText, authorName, authorUserName },
          posted: !dryRun && !!result,
        });
      } catch (err) {
        logger.error('[Test:MemberTweet] エラー', err);
        res.status(500).json({ error: String(err) });
      }
    });

    // POST: 実際の Webhook ペイロード受信
    app.post('/api/webhook/twitter', (req, res) => {
      try {
        // X-API-Key ヘッダーで送信元を検証
        const receivedKey = req.headers['x-api-key'] as string | undefined;
        if (!receivedKey || receivedKey !== config.twitter.twitterApiIoKey) {
          logger.warn('[Webhook] Twitter webhook: 不正な API Key');
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }

        const body = req.body as {
          event_type?: string;
          rule_id?: string;
          rule_tag?: string;
          tweets?: Array<Record<string, any>>;
          timestamp?: number;
        };

        const { tweets, rule_tag } = body;

        if (!tweets || tweets.length === 0) {
          res.status(200).json({ ok: true, processed: 0 });
          return;
        }

        logger.info(
          `[Webhook] Twitter webhook 受信: ${tweets.length}件 (rule: ${rule_tag})${tweets.length > 0 ? ` from:@${tweets[0].author?.userName ?? '?'} "${(tweets[0].text ?? '').slice(0, 60)}"` : ''}`
        );

        const eventBus = getEventBus();
        const myUserId = config.twitter.userId;
        const isQuoteRTWebhook = rule_tag?.includes('quote-rt') ?? false;
        let processed = 0;

        for (const tweet of tweets) {
          const author = tweet.author ?? {};
          const authorId = author.id ?? '';
          const authorUserName = author.userName ?? author.username ?? author.screenName ?? '';
          const authorName = author.name ?? authorUserName;
          const tweetId = tweet.id ?? '';
          const tweetText = tweet.text ?? '';

          // 自分自身のツイートは無視
          if (authorId === myUserId) continue;

          // 処理済みチェック (ポーリングとの二重返信防止)
          if (this.twitterClient.processedTweetIds.has(tweetId)) {
            logger.info(`[Webhook] 既に処理済み: ${tweetId}`);
            continue;
          }

          // 処理済みとしてマーク & ファイル永続化
          this.twitterClient.processedTweetIds.add(tweetId);
          this.twitterClient.saveProcessedIds();

          // ─── 引用RT検知 ───
          if (isQuoteRTWebhook) {
            const quotedTweet = tweet.quoted_tweet ?? tweet.quotedTweet ?? null;
            const quotedText = quotedTweet?.text ?? '';
            const quotedAuthor = quotedTweet?.author?.name ?? quotedTweet?.author?.userName ?? 'Shannon';

            logger.info(
              `[Webhook] 引用RT検知: @${authorUserName} が引用「${tweetText.slice(0, 60)}...」` +
              ` (元ツイート: "${quotedText.slice(0, 60)}...")`,
              'green'
            );

            // いいね
            eventBus.publish({
              type: 'twitter:like_tweet',
              memoryZone: 'twitter:post',
              data: { tweetId, text: '' } as any,
            });

            // 日次返信上限チェック
            if (this.twitterClient.isReplyLimitReached()) {
              logger.info(`[Webhook] 日次返信上限のため引用RTへの返信をスキップ: ${tweetId}`);
              processed++;
              continue;
            }

            this.twitterClient.incrementReplyCount();

            // LLM に返信生成を依頼 (引用RTである文脈を conversationThread で伝える)
            eventBus.publish({
              type: 'llm:post_twitter_reply',
              memoryZone: 'twitter:post',
              data: {
                replyId: tweetId,
                text: tweetText,
                authorName,
                authorId: authorId || null,
                repliedTweet: quotedText || null,
                repliedTweetAuthorName: quotedAuthor,
                conversationThread: [
                  { authorName: quotedAuthor, text: `[元ツイート] ${quotedText}` },
                  { authorName, text: `[引用RT] ${tweetText}` },
                ],
              } as TwitterReplyOutput,
            });

            processed++;
            continue;
          }

          // ─── 通常リプライ処理 ───
          // 日次返信上限チェック
          if (this.twitterClient.isReplyLimitReached()) {
            logger.info(`[Webhook] 日次返信上限に到達: ${tweetId} (by @${authorUserName}) をスキップ`);
            continue;
          }

          // 返信先の元ツイートID
          const inReplyToId =
            tweet.inReplyToId ?? tweet.in_reply_to_status_id ?? tweet.in_reply_to_tweet_id ?? null;

          logger.info(
            `[Webhook] リプライ検知: @${authorUserName} "${tweetText.slice(0, 50)}..." (返信先: ${inReplyToId})`
          );

          // 会話スレッドを非同期で遡って取得してから LLM に渡す
          (async () => {
            const thread: Array<{ authorName: string; text: string }> = [];
            const MAX_CHAIN_DEPTH = 5;

            try {
              let currentReplyToId = inReplyToId;
              for (let depth = 0; depth < MAX_CHAIN_DEPTH && currentReplyToId; depth++) {
                const tweetRes = await fetch(
                  `https://api.twitterapi.io/twitter/tweets?tweet_ids=${currentReplyToId}`,
                  { headers: { 'X-API-Key': config.twitter.twitterApiIoKey } }
                );
                const tweetData = await tweetRes.json() as any;
                const t = tweetData?.tweets?.[0];
                if (!t) break;

                const tAuthor = t.author?.name ?? t.author?.userName ?? t.author?.username ?? '不明';
                thread.unshift({ authorName: tAuthor, text: t.text ?? '' });

                // さらに上の親ツイートを辿る
                currentReplyToId = t.inReplyToId ?? t.in_reply_to_status_id ?? null;
              }
            } catch (err) {
              logger.warn(`[Webhook] 会話スレッド取得失敗: ${err}`);
            }

            logger.info(`[Webhook] 会話スレッド: ${thread.length}件取得 (最大${MAX_CHAIN_DEPTH})`);

            // 返信カウンタをインクリメント
            this.twitterClient.incrementReplyCount();

            // 後方互換: thread[0] を repliedTweet として渡す
            const rootTweet = thread.length > 0 ? thread[0] : null;

            eventBus.publish({
              type: 'llm:post_twitter_reply',
              memoryZone: 'twitter:post',
              data: {
                replyId: tweetId,
                text: tweetText,
                authorName,
                repliedTweet: rootTweet?.text ?? null,
                repliedTweetAuthorName: rootTweet?.authorName ?? null,
                conversationThread: thread.length > 0 ? thread : null,
              } as TwitterReplyOutput,
            });
          })();

          processed++;
        }

        res.status(200).json({ ok: true, processed });
      } catch (error) {
        logger.error('[Webhook] Twitter webhook エラー', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    const port = config.port;
    this.httpServer = app.listen(port, () => {
      logger.info(`HTTP Server listening on port ${port}`, 'blue');
    });
  }

  private async connectDatabase() {
    try {
      const uri = config.mongodbUri;
      logger.info(`Connecting to MongoDB: ${uri}`);
      await mongoose.connect(uri);
      logger.info(`MongoDB connected to: ${mongoose.connection.db.databaseName}`, 'blue');
    } catch (error) {
      logger.error(`MongoDB connection error: ${error}`);
    }
  }

  public async start() {
    try {
      // ファイルログを有効化（ANSI除去済みのプレーンテキストで保存）
      const logsDir = new URL('../logs', import.meta.url).pathname;
      initFileLogging(logsDir);

      // HTTPサーバーを最初に起動
      this.startHTTPServer();

      // データベース接続
      await this.connectDatabase();

      await Promise.all([
        this.startDiscordBot(),
        this.startWebClient(),
        this.startLLMService(),
        this.startTwitterClient(),
        this.startScheduler(),
        this.startYoutubeClient(),
        this.startMinecraftClient(),
        this.startMinebotClient(),
        this.startNotionClient(),
      ]);
    } catch (error) {
      logger.error(`サービス起動エラー: ${error}`);
      process.exit(1);
    }
  }

  private async startDiscordBot() {
    await this.discordBot.start();
  }

  private async startWebClient() {
    await this.webClient.start();
    logger.info('Web Client started', 'blue');
  }

  private async startTwitterClient() {
    await this.twitterClient.start();
    logger.info('Twitter Client started', 'blue');
  }

  private async startLLMService() {
    await this.llmService.initialize();
    logger.info('LLM Service started', 'blue');
  }

  private async startScheduler() {
    await this.scheduler.start();
    logger.info('Scheduler started', 'blue');
  }

  private async startYoutubeClient() {
    try {
      await this.youtubeClient.start();
      logger.info('Youtube Client started', 'blue');
    } catch (error) {
      logger.error(`Youtube Client start error: ${error}`);
      logger.warn('Continuing without Youtube functionality');
    }
  }

  private async startMinecraftClient() {
    await this.minecraftClient.start();
    logger.info('Minecraft Client started', 'blue');
  }

  private async startMinebotClient() {
    await this.minebotClient.start();
    logger.info('Minebot Client started', 'blue');
  }

  private async startNotionClient() {
    await this.notionClient.start();
    logger.info('Notion Client started', 'blue');
  }

  public async shutdown() {
    logger.warn('[Shutdown] グレースフルシャットダウン開始...');

    // 注意: Webhook ルールはシャットダウン時に無効化しない。
    // deactivate → reactivate するとカーソル (last_tweet_id) がリセットされ、
    // 古いツイートが再配信されて無駄な課金が発生するため。
    // ルールは常時有効のままにしておく。

    // 各サービスのクリーンアップ処理
    await mongoose.disconnect();
    logger.error('MongoDB disconnected');
    process.exit(0);
  }
}

// サーバーのインスタンス化と起動
const server = new Server();
server.start();

// グレースフルシャットダウンの処理
process.on('SIGTERM', () => server.shutdown());
process.on('SIGINT', () => server.shutdown());

import {
  YoutubeClientInput,
  YoutubeClientOutput,
  YoutubeCommentOutput,
  YoutubeLiveChatMessageInput,
  YoutubeLiveChatMessageOutput,
  YoutubeSubscriberUpdateOutput,
  YoutubeVideoInput,
} from '@shannon/common';
import { OAuth2Client } from 'google-auth-library';
import { google, youtube_v3 } from 'googleapis';
import { BaseClient } from '../common/BaseClient.js';
import { config } from '../../config/env.js';
import { getEventBus } from '../eventBus/index.js';
import { logger } from '../../utils/logger.js';

export class YoutubeClient extends BaseClient {
  private static instance: YoutubeClient;
  private client: youtube_v3.Youtube | null = null;
  private oauth2Client: OAuth2Client | null = null;
  private channelId: string | null = null;
  public isTest: boolean = false;
  private authCode: string | null = null;
  private refreshToken: string | null = null;
  private lastSubscriberCount: number = 0;
  private liveChatPolling: NodeJS.Timeout | null = null;
  private liveChatId: string | null = null;
  private lastRepliedMessageIds: Set<string> = new Set();
  private liveChatStatus: 'running' | 'stopped' = 'stopped';
  private liveTitle: string | null = null;
  private liveDescription: string | null = null;
  private liveStartTime: Date | null = null;
  private chatHistory: { minutes: number; author: string; message: string }[] =
    [];
  private liveChatWatchStartTime: Date | null = null;

  private constructor(serviceName: 'youtube', isTest: boolean) {
    const eventBus = getEventBus();
    super(serviceName, eventBus);
    this.client = null;
    this.oauth2Client = null;
    this.channelId = config.youtube.channelId || null;
    this.authCode = config.youtube.authCode || null;
    this.lastSubscriberCount = 0;
  }

  public static getInstance(isTest: boolean = false) {
    if (!YoutubeClient.instance) {
      YoutubeClient.instance = new YoutubeClient('youtube', isTest);
    }
    YoutubeClient.instance.isTest = isTest;
    return YoutubeClient.instance;
  }

  private setupEventHandlers() {
    this.eventBus.subscribe('youtube:status', async (event) => {
      const { serviceCommand } = event.data as YoutubeClientInput;
      if (serviceCommand === 'start') {
        await this.start();
      } else if (serviceCommand === 'stop') {
        await this.stop();
      } else if (serviceCommand === 'status') {
        this.eventBus.publish({
          type: 'web:status',
          memoryZone: 'web',
          data: {
            service: 'youtube',
            status: this.status,
          },
        });
      }
    });

    this.eventBus.subscribe('youtube:check_comments', async () => {
      if (this.status !== 'running') return;
      try {
        const unrepliedComments = await this.getUnrepliedComments();
        for (const comment of unrepliedComments) {
          this.eventBus.publish({
            type: 'llm:reply_youtube_comment',
            memoryZone: 'youtube',
            data: comment as YoutubeCommentOutput,
          });
        }
      } catch (error) {
        logger.error(`Check comments error: ${error}`);
      }
    });

    this.eventBus.subscribe('youtube:check_subscribers', async () => {
      if (this.status !== 'running') return;
      try {
        const subscriberCount = await this.getSubscriberCount();
        if (subscriberCount > this.lastSubscriberCount) {
          this.lastSubscriberCount = subscriberCount;
          this.eventBus.publish({
            type: 'youtube:subscriber_update',
            memoryZone: 'discord:aiminelab_server',
            data: {
              subscriberCount,
            } as YoutubeSubscriberUpdateOutput,
          });
        }
      } catch (error) {
        logger.error(`Check subscribers error: ${error}`);
      }
    });

    this.eventBus.subscribe('youtube:reply_comment', async (event) => {
      const { videoId, commentId, reply } = event.data as YoutubeVideoInput;
      if (!videoId || !commentId || !reply) {
        logger.error(
          `Invalid input for replyComment: ${JSON.stringify(event.data)}`
        );
        return;
      }

      await this.replyComment(videoId, commentId, reply);
    });
    this.eventBus.subscribe('youtube:get_video_info', async (event) => {
      const { videoId } = event.data as YoutubeClientInput;
      if (!videoId) {
        logger.error(
          `Invalid input for getVideoInfo: ${JSON.stringify(event.data)}`
        );
        return;
      }
      const videoInfo = await this.getVideoInfo(videoId);
      this.eventBus.publish({
        type: 'tool:get_video_info',
        memoryZone: 'youtube',
        data: videoInfo as YoutubeClientOutput,
      });
    });

    // ライブチャット監視開始/終了
    this.eventBus.subscribe('youtube:live_chat:status', async (event) => {
      const { serviceCommand } = event.data as YoutubeClientInput;
      if (serviceCommand === 'start') {
        const result = await this.startLiveChatPolling();
        if (result.success) {
          this.liveChatStatus = 'running';
        }
      } else if (serviceCommand === 'stop') {
        await this.stopLiveChatPolling();
        this.liveChatStatus = 'stopped';
      } else if (serviceCommand === 'status') {
        this.eventBus.publish({
          type: 'web:status',
          memoryZone: 'web',
          data: {
            service: 'youtube:live_chat',
            status: this.liveChatStatus,
          },
        });
      }
    });

    this.eventBus.subscribe('youtube:live_chat:post_message', async (event) => {
      const { response } = event.data as YoutubeLiveChatMessageInput;
      await this.sendLiveChatMessage(response);
    });
  }

  private async getAuthUrl() {
    try {
      const oauth2Client = new google.auth.OAuth2(
        config.youtube.clientId,
        config.youtube.clientSecret,
        'http://localhost'
      );
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/youtube.force-ssl'],
      });

      logger.info('以下のURLにアクセスして認証してください:');
      logger.info(authUrl);
    } catch (error) {
      logger.error(`YouTube getClient error: ${error}`);
      throw error;
    }
  }

  private async getRefreshToken() {
    try {
      const oauth2Client = new google.auth.OAuth2(
        config.youtube.clientId,
        config.youtube.clientSecret,
        'http://localhost'
      );
      // await this.getAuthUrl(oauth2Client);

      if (!this.authCode) {
        throw new Error('認証コードが設定されていません');
      }
      logger.debug(`authCode: ${this.authCode ? '***' : '(empty)'}`);

      const { tokens } = await oauth2Client.getToken(this.authCode);
      this.refreshToken = tokens.refresh_token || null;
      logger.debug(`Refresh token obtained: ${tokens.refresh_token ? '***' : '(empty)'}`);
    } catch (error) {
      logger.error(`YouTube getRefreshToken error: ${error}`);
      throw error;
    }
  }

  /**
   * 自分のチャンネルの最新動画のコメントを取得し、未返信のものを返す
   */
  public async getUnrepliedComments() {
    if (this.status !== 'running' || !this.channelId) return [];

    try {
      // 自分の最新動画を取得（例：最新3件）
      if (!this.client) {
        throw new Error('YouTube client is not initialized');
      }
      const videos = await this.client.search.list({
        part: ['id', 'snippet'],
        channelId: this.channelId,
        order: 'date',
        type: ['video'],
        maxResults: 3,
      });
      const unrepliedComments = [];
      // 各動画のコメントをチェック
      for (const video of videos.data.items || []) {
        const videoId = video.id?.videoId;
        const title = video.snippet?.title;
        const description = video.snippet?.description;
        if (!videoId) continue;
        logger.debug(`Checking comments for video: ${videoId} ${title}`);
        // コメントスレッドを取得
        const comments = await this.client.commentThreads.list({
          part: ['snippet', 'replies'],
          videoId: videoId,
          maxResults: 100,
        });
        // 各コメントスレッドをチェック
        for (const thread of comments.data.items || []) {
          const topComment = thread.snippet?.topLevelComment?.snippet;
          const hasReplies = thread.replies?.comments || [];
          if (
            topComment &&
            topComment.authorChannelId?.value !== this.channelId && // 自分以外のコメント
            !hasReplies.some(
              (reply) =>
                reply.snippet?.authorChannelId?.value === this.channelId // 自分の返信がない
            )
          ) {
            unrepliedComments.push({
              videoId,
              commentId: thread.id,
              text: topComment.textDisplay,
              authorName: topComment.authorDisplayName,
              publishedAt: topComment.publishedAt,
              videoTitle: title,
              videoDescription: description,
            });
          }
        }
      }
      return unrepliedComments;
    } catch (error) {
      logger.error(`YouTube comments fetch error: ${error}`);
      throw error;
    }
  }

  public async getSubscriberCount() {
    if (this.status !== 'running' || !this.channelId) return 0;
    if (!this.client) {
      throw new Error('YouTube client is not initialized');
    }
    try {
      const response = await this.client.channels.list({
        part: ['statistics'],
        id: [this.channelId],
      });
      logger.debug(`subscriberCount: ${response.data.items?.[0]?.statistics?.subscriberCount}`);
      return parseInt(
        response.data.items?.[0]?.statistics?.subscriberCount || '0'
      );
    } catch (error) {
      logger.error(`YouTube subscriber count fetch error: ${error}`);
      throw error;
    }
  }

  /**
   * 指定されたコメントに返信する
   * @param videoId 動画ID
   * @param commentId コメントID
   * @param reply 返信内容
   */
  public async replyComment(videoId: string, commentId: string, reply: string) {
    if (this.status !== 'running') return;
    if (!this.client) {
      throw new Error('YouTube client is not initialized!');
    }
    try {
      await this.client.comments.insert({
        part: ['snippet'],
        requestBody: {
          snippet: {
            textOriginal: reply,
            parentId: commentId,
            videoId: videoId,
          },
        },
      });
      logger.success(`Replied to comment ${commentId} on video ${videoId}`);
    } catch (error) {
      logger.error(`YouTube reply error: ${error}`);
      throw error;
    }
  }

  public async initialize() {
    try {
      // await this.getAuthUrl();
      // await this.getRefreshToken();
      try {
        await this.setUpConnection();
        this.setupEventHandlers();
        this.lastSubscriberCount = await this.getSubscriberCount();
        logger.debug(`lastSubscriberCount: ${this.lastSubscriberCount}`);
      } catch (error) {
        logger.error(`YouTube initialization error: ${error}`);
        logger.warn('YouTube initialization failed, but continuing without YouTube functionality!');
        // エラーをスローせずに処理を続行
        this.status = 'stopped';
      }
    } catch (error) {
      logger.error(`YouTube initialization outer error: ${error}`);
      logger.warn('YouTube initialization failed, but continuing without YouTube functionality');
      // エラーをスローせずに処理を続行
      this.status = 'stopped';
    }
  }

  private async setUpConnection() {
    try {
      const clientId = config.youtube.clientId;
      const clientSecret = config.youtube.clientSecret;
      this.refreshToken = config.youtube.refreshToken || null;
      logger.debug(`YouTube OAuth2: clientId=${clientId ? '***' : '(empty)'}, refreshToken=${this.refreshToken ? '***' : '(empty)'}`);

      if (!clientId || !clientSecret || !this.refreshToken) {
        logger.warn('YouTube OAuth2認証情報が設定されていません。YouTube機能は無効化されます。');
        this.status = 'stopped';
        return; // 認証情報がない場合は早期リターン
      }

      this.oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        'http://localhost' // リダイレクトURIは実際の設定に合わせてください
      );

      this.oauth2Client.setCredentials({
        refresh_token: this.refreshToken,
      });

      this.client = google.youtube({
        version: 'v3',
        auth: this.oauth2Client,
      });
    } catch (error) {
      logger.error(`YouTube setUpConnection error: ${error}`);
      logger.warn('YouTube connection failed, but continuing without YouTube functionality');
      this.status = 'stopped';
      // エラーをスローせずに処理を続行
    }
  }

  /**
   * 動画IDからタイトル・投稿者名・サムネイルURL・説明・公開日・視聴回数・いいね数・コメント数を取得
   */
  public async getVideoInfo(videoId: string) {
    if (!this.client) {
      throw new Error('YouTube client is not initialized');
    }
    try {
      const response = await this.client.videos.list({
        part: ['snippet', 'statistics'],
        id: [videoId],
      });
      const video = response.data.items?.[0];
      if (!video) {
        throw new Error('動画が見つかりません');
      }
      const title = video.snippet?.title || '';
      const author = video.snippet?.channelTitle || '';
      const thumbnail =
        video.snippet?.thumbnails?.high?.url ||
        video.snippet?.thumbnails?.default?.url ||
        '';
      const description = video.snippet?.description || '';
      const publishedAt = video.snippet?.publishedAt || '';
      const viewCount = Number(video.statistics?.viewCount || 0);
      const likeCount = Number(video.statistics?.likeCount || 0);
      const commentCount = Number(video.statistics?.commentCount || 0);
      logger.info(`videoInfo: ${JSON.stringify({ title, author, thumbnail, description, publishedAt, viewCount, likeCount, commentCount })}`);

      return {
        title,
        author,
        thumbnail,
        description,
        publishedAt,
        viewCount,
        likeCount,
        commentCount,
      };
    } catch (error) {
      logger.error(`YouTube getVideoInfo error: ${error}`);
      throw error;
    }
  }

  private async startLiveChatPolling() {
    if (!this.client) {
      logger.error('YouTube client is not initialized');
      return { success: false, message: 'YouTube client is not initialized' };
    }
    const videoId = await this.getCurrentLiveVideoId();
    console.log('🎥 取得したvideoId:', videoId);
    console.log('🔗 YOUTUBE_LIVE_URL:', process.env.YOUTUBE_LIVE_URL);
    if (!videoId) {
      logger.error('ライブ配信中の動画が見つかりません');
      return { success: false, message: 'ライブ配信中の動画が見つかりません' };
    }
    // 既に監視中なら一度止める
    if (this.liveChatPolling) {
      clearInterval(this.liveChatPolling);
      this.liveChatPolling = null;
    }
    // liveChatId取得 & タイトル・概要欄・開始時刻取得
    let liveChatId: string | null = null;
    try {
      const videoResponse = await this.client.videos.list({
        part: ['liveStreamingDetails', 'snippet'],
        id: [videoId],
      });
      const video = videoResponse.data.items?.[0];
      console.log('📺 動画情報:', JSON.stringify({
        title: video?.snippet?.title,
        liveBroadcastContent: video?.snippet?.liveBroadcastContent,
        liveStreamingDetails: video?.liveStreamingDetails,
      }, null, 2));
      liveChatId = (video?.liveStreamingDetails as any)?.activeLiveChatId;
      if (!liveChatId) {
        logger.error('liveChatIdが取得できませんでした');
        return { success: false, message: 'liveChatIdが取得できませんでした' };
      }
      this.liveChatId = liveChatId;
      this.liveTitle = video?.snippet?.title || null;
      this.liveDescription = video?.snippet?.description || null;
      this.liveStartTime = video?.liveStreamingDetails?.actualStartTime
        ? new Date(video.liveStreamingDetails.actualStartTime)
        : null;
      this.chatHistory = [];
      this.liveChatWatchStartTime = new Date(); // 監視開始時刻を記録
      // 1分ごとにコメント取得
      this.liveChatPolling = setInterval(() => {
        this.fetchLiveChatMessages();
      }, 60 * 1000);
      // 初回即時実行
      this.fetchLiveChatMessages();
      logger.info('ライブチャット監視を開始しました');
      return { success: true, message: 'ライブチャット監視を開始しました' };
    } catch (error) {
      logger.error('ライブチャット監視開始エラー', error);
      return { success: false, message: 'ライブチャット監視開始エラー' };
    }
  }

  private stopLiveChatPolling() {
    if (this.liveChatPolling) {
      clearInterval(this.liveChatPolling);
      this.liveChatPolling = null;
      this.liveChatId = null;
      logger.info('ライブチャット監視を停止しました');
    }
  }

  private async fetchLiveChatMessages() {
    if (!this.client || !this.liveChatId) return;
    try {
      const chatResponse = await this.client.liveChatMessages.list({
        liveChatId: this.liveChatId,
        part: ['snippet', 'authorDetails'],
        maxResults: 200,
      });
      const messages = chatResponse.data.items || [];
      // 未返信かつ自分以外、かつ監視開始時刻以降、かつ「シャノン、」で始まるコメントのみ抽出
      const unrepliedMessages = messages.filter(
        (msg) =>
          msg.id &&
          !this.lastRepliedMessageIds.has(msg.id ?? '') &&
          msg.authorDetails?.channelId !== this.channelId &&
          (
            !this.liveChatWatchStartTime ||
            (msg.snippet?.publishedAt && new Date(msg.snippet.publishedAt) >= this.liveChatWatchStartTime)
          ) &&
          (msg.snippet?.displayMessage?.startsWith('シャノン、') ?? false)
      );
      if (unrepliedMessages.length > 0) {
        // ランダムに1件選ぶ
        const randomIndex = Math.floor(Math.random() * unrepliedMessages.length);
        const msg = unrepliedMessages[randomIndex];
        this.lastRepliedMessageIds.add(msg.id ?? '');
        const author = msg.authorDetails?.displayName ?? '';
        const message = msg.snippet?.displayMessage ?? '';
        if (author !== '' && message !== '') {
          // 履歴に追加
          this.chatHistory.push({
            minutes: 0, // ライブチャットの場合は0分
            author,
            message,
          });
          // 履歴を「分数：名前「内容」」形式で
          const formattedHistory = this.chatHistory.map(
            (h) => `${h.minutes}：${h.author}「${h.message}」`
          );
          // publish
          this.eventBus.publish({
            type: 'llm:get_youtube_message',
            memoryZone: 'youtube',
            data: {
              message,
              author,
              jstNow: new Date().toISOString(),
              minutesSinceStart: 0,
              history: formattedHistory,
              liveTitle: this.liveTitle ?? '',
              liveDescription: this.liveDescription ?? '',
            } as YoutubeLiveChatMessageOutput,
          });
        }
      }
    } catch (error) {
      logger.error('ライブチャット取得エラー', error);
    }
  }

  // 任意の文字列をライブチャットに投稿する
  public async sendLiveChatMessage(message: string) {
    if (!this.client || !this.liveChatId) return;
    try {
      await this.client.liveChatMessages.insert({
        part: ['snippet'],
        requestBody: {
          snippet: {
            liveChatId: this.liveChatId,
            type: 'textMessageEvent',
            textMessageDetails: {
              messageText: message,
            },
          },
        },
      });
      logger.info(`ライブチャットにコメントを投稿: ${message}`);
    } catch (error) {
      logger.error('ライブチャットコメント投稿エラー', error);
    }
  }

  async getCurrentLiveVideoId(): Promise<string | null> {
    // .envからURL取得/
    const liveUrl = config.youtube.liveUrl;
    if (liveUrl) {
      // 正規表現で動画ID抽出（v=, /video/, /watch/, youtu.be/ など対応）
      const match = liveUrl.match(/(?:v=|\/(?:video|live)\/|youtu\.be\/|watch\?v=)([a-zA-Z0-9_-]{11})/);
      if (match && match[1]) {
        return match[1];
      }
    }
    // なければ従来通り
    if (!this.client || !this.channelId) return null;
    const res = await this.client.search.list({
      part: ['id'],
      channelId: this.channelId,
      eventType: 'live',
      type: ['video'],
      maxResults: 1,
    });
    const videoId = res.data.items?.[0]?.id?.videoId;
    return videoId || null;
  }
}

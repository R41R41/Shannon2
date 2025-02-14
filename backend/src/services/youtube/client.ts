import { YoutubeClientInput, YoutubeClientOutput } from '@shannon/common';
import dotenv from 'dotenv';
import { OAuth2Client } from 'google-auth-library';
import { google, youtube_v3 } from 'googleapis';
import { BaseClient } from '../common/BaseClient.js';
import { EventBus } from '../eventBus/eventBus.js';

dotenv.config();

export class YoutubeClient extends BaseClient {
  private client: youtube_v3.Youtube;
  private oauth2Client: OAuth2Client;
  private channelId: string | null = null;
  public isTest: boolean = false;
  private static instance: YoutubeClient;

  public static getInstance(eventBus: EventBus, isTest: boolean = false) {
    if (!YoutubeClient.instance) {
      YoutubeClient.instance = new YoutubeClient('youtube', eventBus, isTest);
    }
    YoutubeClient.instance.isTest = isTest;
    return YoutubeClient.instance;
  }

  private constructor(
    serviceName: 'youtube',
    eventBus: EventBus,
    isTest: boolean
  ) {
    super(serviceName, eventBus);

    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error('YouTube OAuth2認証情報が設定されていません');
    }

    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      'http://localhost' // リダイレクトURIは実際の設定に合わせてください
    );

    this.oauth2Client.setCredentials({
      refresh_token: refreshToken,
    });

    this.client = google.youtube({
      version: 'v3',
      auth: this.oauth2Client,
    });

    this.channelId = process.env.YOUTUBE_CHANNEL_ID || null;
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
            data: comment as YoutubeClientOutput,
          });
        }
      } catch (error) {
        console.error(`\x1b[31mCheck comments error: ${error}\x1b[0m`);
      }
    });

    this.eventBus.subscribe('youtube:reply_comment', async (event) => {
      const { videoId, commentId, reply } = event.data as YoutubeClientInput;
      if (!videoId || !commentId || !reply) {
        console.error(
          `\x1b[31mInvalid input for replyComment: ${JSON.stringify(
            event.data
          )}\x1b[0m`
        );
        return;
      }

      await this.replyComment(videoId, commentId, reply);
    });
  }

  public async getRefreshToken() {
    const oauth2Client = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
      'http://localhost'
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/youtube.force-ssl'],
    });

    console.log('以下のURLにアクセスして認証してください:');
    console.log(authUrl);

    // 認証コードを入力（実際の実装ではプロンプトなどを使用）
    const code =
      'ここに表示されたURLにアクセスして認証後に取得したコードを貼り付け';

    const { tokens } = await oauth2Client.getToken(code);
    console.log('Refresh token:', tokens.refresh_token);
  }

  /**
   * 自分のチャンネルの最新動画のコメントを取得し、未返信のものを返す
   */
  public async getUnrepliedComments() {
    if (this.status !== 'running' || !this.channelId) return [];

    try {
      // 自分の最新動画を取得（例：最新3件）
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
        console.log(
          `\x1b[34mChecking comments for video: ${videoId} ${title}\x1b[0m`
        );
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
      console.error(`\x1b[31mYouTube comments fetch error: ${error}\x1b[0m`);
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
      console.log(
        `\x1b[32mReplied to comment ${commentId} on video ${videoId}\x1b[0m`
      );
    } catch (error) {
      console.error(`\x1b[31mYouTube reply error: ${error}\x1b[0m`);
      throw error;
    }
  }

  public async initialize() {
    try {
      // await this.getRefreshToken();
      this.setupEventHandlers();
    } catch (error) {
      console.error(`\x1b[31mYouTube initialization error: ${error}\x1b[0m`);
      throw error;
    }
  }
}

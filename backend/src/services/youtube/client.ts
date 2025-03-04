import {
  YoutubeClientInput,
  YoutubeClientOutput,
  YoutubeCommentOutput,
  YoutubeSubscriberUpdateOutput,
} from '@shannon/common';
import dotenv from 'dotenv';
import { OAuth2Client } from 'google-auth-library';
import { google, youtube_v3 } from 'googleapis';
import { BaseClient } from '../common/BaseClient.js';
import { getEventBus } from '../eventBus/index.js';
import express from 'express';
import axios from 'axios';
dotenv.config();

export class YoutubeClient extends BaseClient {
  private static instance: YoutubeClient;
  private client: youtube_v3.Youtube | null = null;
  private oauth2Client: OAuth2Client | null = null;
  private channelId: string | null = null;
  public isTest: boolean = false;
  private authCode: string | null = null;
  private refreshToken: string | null = null;

  private constructor(serviceName: 'youtube', isTest: boolean) {
    const eventBus = getEventBus();
    super(serviceName, eventBus);
    this.client = null;
    this.oauth2Client = null;
    this.channelId = process.env.YOUTUBE_CHANNEL_ID || null;
    this.authCode = process.env.YOUTUBE_AUTH_CODE || null;
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

  private async getAuthUrl(oauth2Client: OAuth2Client) {
    try {
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/youtube.force-ssl'],
      });

      console.log('以下のURLにアクセスして認証してください:');
      console.log(authUrl);
    } catch (error) {
      console.error(`\x1b[31mYouTube getClient error: ${error}\x1b[0m`);
      throw error;
    }
  }

  private async getRefreshToken() {
    try {
      const oauth2Client = new google.auth.OAuth2(
        process.env.YOUTUBE_CLIENT_ID,
        process.env.YOUTUBE_CLIENT_SECRET,
        'http://localhost'
      );
      // await this.getAuthUrl(oauth2Client);

      if (!this.authCode) {
        throw new Error('認証コードが設定されていません');
      }
      console.log('authCode:', this.authCode);

      const { tokens } = await oauth2Client.getToken(this.authCode);
      this.refreshToken = tokens.refresh_token || null;
      console.log('Refresh token:', tokens.refresh_token);
    } catch (error) {
      console.error(`\x1b[31mYouTube getRefreshToken error: ${error}\x1b[0m`);
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
    if (!this.client) {
      throw new Error('YouTube client is not initialized');
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
      console.log(
        `\x1b[32mReplied to comment ${commentId} on video ${videoId}\x1b[0m`
      );
    } catch (error) {
      console.error(`\x1b[31mYouTube reply error: ${error}\x1b[0m`);
      throw error;
    }
  }

  private async setupPubSubNotifications() {
    try {
      if (!this.client || !this.channelId) return;
      const app = express();
      const PORT = process.env.YOUTUBE_WEBHOOK_PORT || 5018;

      app.use(express.json());

      // Webhookエンドポイント
      app.post('/youtube/webhook/comments', (req: any, res: any) => {
        const notification = req.body;
        console.log('YouTube コメント通知を受信:', notification);

        // 新しいコメントの処理
        if (notification.feed && notification.feed.entry) {
          const entry = notification.feed.entry;
          console.log('entry:', entry);
          // コメント情報を抽出
          const comment = {
            videoId: this.extractVideoId(entry.link),
            commentId: entry.id,
            text: entry.content,
            authorName: entry.author.name,
            publishedAt: entry.published,
            videoTitle: entry.title,
            videoDescription: entry.summary,
          };

          // イベントバスに通知
          this.eventBus.publish({
            type: 'llm:reply_youtube_comment',
            memoryZone: 'youtube',
            data: comment as YoutubeCommentOutput,
          });
        }

        res.status(200).send('OK');
      });

      // チャンネル登録者数通知用Webhookエンドポイント
      app.post('/youtube/webhook/subscribers', (req: any, res: any) => {
        const notification = req.body;
        console.log('YouTube 登録者数通知を受信:', notification);

        // チャンネル情報の処理
        if (notification.feed && notification.feed.entry) {
          const entry = notification.feed.entry;
          // 登録者数情報を抽出
          const subscriberCount = entry['yt:statistics']
            ? entry['yt:statistics'].subscriberCount
            : null;

          if (subscriberCount) {
            // イベントバスに通知
            this.eventBus.publish({
              type: 'youtube:subscriber_update',
              memoryZone: 'youtube',
              data: {
                subscriberCount: subscriberCount,
              } as YoutubeSubscriberUpdateOutput,
            });
          }
        }

        res.status(200).send('OK');
      });

      // 検証リクエスト用エンドポイント
      app.get('/youtube/webhook/comments', (req, res) => {
        const hubChallenge = req.query['hub.challenge'];
        console.log('YouTube検証リクエスト受信:', req.query);

        if (hubChallenge) {
          // 検証に成功するには同じチャレンジ値を返す
          res.status(200).send(hubChallenge);
          console.log('YouTube検証成功');
        } else {
          res.status(400).send('Bad Request');
        }
      });

      app.get('/youtube/webhook/subscribers', (req, res) => {
        const hubChallenge = req.query['hub.challenge'];
        console.log('YouTube登録者検証リクエスト受信:', req.query);

        if (hubChallenge) {
          res.status(200).send(hubChallenge);
          console.log('YouTube登録者検証成功');
        } else {
          res.status(400).send('Bad Request');
        }
      });

      // サーバー起動
      app.listen(PORT, () => {
        console.log(`YouTube Webhook server running on port ${PORT}`);
      });

      // PubSubHubBubへの登録を修正
      const callbackUrl = `http://sh4nnon.com:5018/youtube/webhook/comments`;
      const topicUrl = `https://www.youtube.com/xml/feeds/comments/videos?channel_id=${this.channelId}`;

      const params = new URLSearchParams();
      params.append('hub.callback', callbackUrl);
      params.append('hub.topic', topicUrl);
      params.append('hub.verify', 'sync'); // asyncではなくsyncを試す
      params.append('hub.mode', 'subscribe');
      params.append('hub.lease_seconds', '86400');

      // PubSubHubBubへの登録リクエスト
      console.log('PubSubHubBubへリクエスト送信:', params.toString());
      const response = await axios.post(
        'https://pubsubhubbub.appspot.com/subscribe',
        params,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      console.log(
        'YouTube PubSubHubBub登録レスポンス:',
        response.status,
        response.data
      );
    } catch (error: any) {
      console.error(`\x1b[31mYouTube PubSub setup error: ${error}\x1b[0m`);
      // エラーの詳細を表示
      if (error.response) {
        console.error(
          'エラーレスポンス:',
          error.response.status,
          error.response.data
        );
      }
    }
  }

  public async initialize() {
    try {
      // await this.getRefreshToken();
      await this.setUpConnection();
      this.setupEventHandlers();
      // PubSubの設定を追加
      await this.setupPubSubNotifications();
    } catch (error) {
      console.error(`\x1b[31mYouTube initialization error: ${error}\x1b[0m`);
      throw error;
    }
  }

  private async setUpConnection() {
    try {
      const clientId = process.env.YOUTUBE_CLIENT_ID;
      const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
      this.refreshToken = process.env.YOUTUBE_REFRESH_TOKEN || null;
      console.log(clientId, clientSecret, this.refreshToken);

      if (!clientId || !clientSecret || !this.refreshToken) {
        throw new Error('YouTube OAuth2認証情報が設定されていません');
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
      console.error(`\x1b[31mYouTube setUpConnection error: ${error}\x1b[0m`);
      throw error;
    }
  }

  // ヘルパーメソッド
  private extractVideoId(link: string): string {
    const match = link.match(/videos\/([^\/\?]+)/);
    return match ? match[1] : '';
  }
}

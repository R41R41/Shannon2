import { TwitterApi } from 'twitter-api-v2';
import { EventBus } from '../eventBus.js';
import { LLMMessage } from '../llm/types/index.js';

export class TwitterClient {
  private client: TwitterApi;
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    const apiKey = process.env.TWITTER_API_KEY;
    const apiKeySecret = process.env.TWITTER_API_SECRET;
    const accessToken = process.env.TWITTER_ACCESS_TOKEN;
    const accessTokenSecret = process.env.TWITTER_ACCESS_SECRET;

    if (!apiKey || !apiKeySecret || !accessToken || !accessTokenSecret) {
      throw new Error('Twitter APIの認証情報が設定されていません');
    }

    this.client = new TwitterApi({
      appKey: apiKey,
      appSecret: apiKeySecret,
      accessToken: accessToken,
      accessSecret: accessTokenSecret,
    });

    this.eventBus = eventBus;
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.eventBus.subscribe('twitter:post', async (event) => {
      if (event.platform === 'twitter') {
        try {
          await this.client.v2.reply(event.data.content, event.data.tweetId);
        } catch (error) {
          console.error('Twitter reply error:', error);
        }
      }
    });
  }

  async tweet(content: string) {
    try {
      const response = await this.client.v2.tweet(content);

      // ツイート内容をDiscordにも送信
      this.eventBus.publish({
        type: 'twitter:post',
        platform: 'twitter',
        data: {
          content: content,
          tweetId: response.data.id,
        },
        targetPlatforms: ['discord'], // Discordにも送信
      });

      return response.data;
    } catch (error) {
      console.error('Tweet error:', error);
      throw error;
    }
  }

  async handleTweet(tweetId: string, content: string) {
    const message: LLMMessage = {
      platform: 'twitter',
      type: 'text',
      content: content,
      context: {
        tweetId: tweetId,
      },
    };
    this.eventBus.publish({
      type: 'twitter:post',
      platform: 'twitter',
      data: message,
    });
  }

  async searchAndReply(keyword: string) {
    try {
      const tweets = await this.client.v2.search(keyword);
      for await (const tweet of tweets) {
        await this.handleTweet(tweet.id, tweet.text);
        // レート制限を考慮して待機
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error('Search and reply error:', error);
      throw new Error('検索と返信処理に失敗しました');
    }
  }

  public async initialize() {
    try {
      // 初期化処理（例：接続テスト）
      await this.client.v2.me();
      this.setupEventHandlers();
    } catch (error) {
      console.error('Twitter initialization error:', error);
      throw error;
    }
  }
}

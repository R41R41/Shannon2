import { TwitterApi } from 'twitter-api-v2';
import { LLMService } from '../llm/client.js';

export class TwitterClient {
  private client: TwitterApi;
  private llm: LLMService;

  constructor() {
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

    this.llm = new LLMService();
  }

  async tweet(content: string) {
    try {
      const response = await this.client.v2.tweet(content);
      return response.data;
    } catch (error) {
      console.error('Tweet error:', error);
      throw new Error('ツイートの投稿に失敗しました');
    }
  }

  async replyWithAI(tweetId: string, content: string) {
    try {
      const aiResponse = await this.llm.chat(content, 'twitter');
      if (aiResponse.error) throw new Error(aiResponse.error);

      const response = await this.client.v2.reply(
        aiResponse.content,
        tweetId
      );
      return response.data;
    } catch (error) {
      console.error('AI Reply error:', error);
      throw new Error('AIでの返信に失敗しました');
    }
  }

  async searchAndReply(keyword: string) {
    try {
      const tweets = await this.client.v2.search(keyword);
      for await (const tweet of tweets) {
        await this.replyWithAI(tweet.id, tweet.text);
        // レート制限を考慮して待機
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error('Search and reply error:', error);
      throw new Error('検索と返信処理に失敗しました');
    }
  }
} 
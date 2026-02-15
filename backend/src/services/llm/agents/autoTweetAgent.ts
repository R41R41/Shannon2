import { TwitterTrendData } from '@shannon/common';
import { config } from '../../../config/env.js';
import { loadPrompt } from '../config/prompts.js';
import { generateTweetForAutoPost } from '../tools/generateTweetText.js';

/**
 * AutoTweetAgent: トレンド情報を元にシャノンのキャラでツイートを自動生成する
 * 内部で generateTweetForAutoPost（プロンプト + few-shot例ベース）を使用
 */
export class AutoTweetAgent {
  private systemPrompt: string;

  private constructor(systemPrompt: string) {
    this.systemPrompt = systemPrompt;
  }

  public static async create(): Promise<AutoTweetAgent> {
    const prompt = await loadPrompt('auto_tweet');
    if (!prompt) {
      throw new Error('Failed to load auto_tweet prompt');
    }
    return new AutoTweetAgent(prompt);
  }

  /**
   * トレンドデータと今日の情報からツイートを生成する
   */
  public async generateTweet(
    trends: TwitterTrendData[],
    todayInfo: string
  ): Promise<string> {
    const trendsText = trends
      .map((t) => `${t.rank}. ${t.name}${t.metaDescription ? ` - ${t.metaDescription}` : ''}`)
      .join('\n');

    const topic = [
      `# 今日の情報`,
      todayInfo,
      '',
      `# 現在のトレンド (日本)`,
      trendsText,
      '',
      config.isDev
        ? 'トレンドから安全なトピックを1つ選んで、シャノンらしいツイートを1つ書いて。140文字以内。ツイート本文のみ出力。'
        : 'トレンドから安全なトピックを1つ選んで、シャノンらしいツイートを1つ書いて。文字数制限なし。ツイート本文のみ出力。',
    ].join('\n');

    try {
      const result = await generateTweetForAutoPost(topic, this.systemPrompt);

      if (!result) {
        console.warn('🐦 AutoTweetAgent: 生成失敗（空の結果）');
        return '';
      }

      return result;
    } catch (error) {
      console.error('🐦 AutoTweetAgent error:', error);
      return '';
    }
  }
}

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { loadPrompt } from '../config/prompts.js';
import { config } from '../../../config/env.js';
import { models } from '../../../config/models.js';

const OPENAI_API_KEY = config.openaiApiKey;
if (!OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set');
}

export class ReplyTwitterCommentAgent {
  private model: ChatOpenAI;
  private systemPrompt: string;

  private constructor(systemPrompt: string) {
    this.model = new ChatOpenAI({
      modelName: models.contentGeneration,
      temperature: 1,
      apiKey: OPENAI_API_KEY,
    });
    this.systemPrompt = systemPrompt;
  }

  public static async create(): Promise<ReplyTwitterCommentAgent> {
    const prompt = await loadPrompt('reply_twitter_comment');
    if (!prompt) {
      throw new Error('Failed to load reply_twitter_comment prompt');
    }
    return new ReplyTwitterCommentAgent(prompt);
  }

  public async reply(
    text: string,
    authorName: string,
    repliedTweet?: string | null,
    repliedTweetAuthorName?: string | null,
    conversationThread?: Array<{ authorName: string; text: string }> | null
  ): Promise<string> {
    if (!this.systemPrompt) {
      throw new Error('systemPrompt is not set');
    }
    const systemContent = this.systemPrompt;

    // 文脈を構築
    const lines: string[] = [];

    if (conversationThread && conversationThread.length > 0) {
      // 会話スレッド全体がある場合: 古い順に表示
      lines.push('【会話の流れ】');
      for (const msg of conversationThread) {
        lines.push(`${msg.authorName}: ${msg.text}`);
      }
      lines.push('');
      lines.push(`【これに対する ${authorName} の最新返信（↓あなたが返信する対象）】`);
      lines.push(text);
    } else if (repliedTweet) {
      // フォールバック: 1段階の元ツイートのみ
      lines.push(`【元ツイート（${repliedTweetAuthorName ?? '不明'}の投稿）】`);
      lines.push(repliedTweet);
      lines.push('');
      lines.push(`【${authorName} からの返信】`);
      lines.push(text);
    } else {
      // 元ツイートなし: 直接のリプライ
      lines.push(`【${authorName} からのリプライ】`);
      lines.push(text);
    }

    const humanContent = lines.join('\n');
    const response = await this.model.invoke([
      new SystemMessage(systemContent),
      new HumanMessage(humanContent),
    ]);
    return response.content.toString();
  }
}

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import dotenv from 'dotenv';
import { loadPrompt } from '../config/prompts.js';

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set');
}

export class ReplyTwitterCommentAgent {
  private model: ChatOpenAI;
  private systemPrompt: string;

  private constructor(systemPrompt: string) {
    this.model = new ChatOpenAI({
      modelName: 'gpt-4o',
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

  public async reply(comment: string, myTweet: string): Promise<string> {
    if (!this.systemPrompt) {
      throw new Error('systemPrompt is not set');
    }
    const systemContent = this.systemPrompt;
    const humanContent = `コメント:${comment}\n自分のツイート:${myTweet}`;
    const response = await this.model.invoke([
      new SystemMessage(systemContent),
      new HumanMessage(humanContent),
    ]);
    return response.content.toString();
  }
}

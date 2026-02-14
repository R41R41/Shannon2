import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { loadPrompt } from '../config/prompts.js';
import { config } from '../../../config/env.js';
import { models } from '../../../config/models.js';

const OPENAI_API_KEY = config.openaiApiKey;
if (!OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set');
}

export class ReplyYoutubeCommentAgent {
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

  public static async create(): Promise<ReplyYoutubeCommentAgent> {
    const prompt = await loadPrompt('reply_youtube_comment');
    if (!prompt) {
      throw new Error('Failed to load reply_youtube_comment prompt');
    }
    return new ReplyYoutubeCommentAgent(prompt);
  }

  public async reply(
    comment: string,
    videoTitle: string,
    videoDescription: string,
    authorName: string
  ): Promise<string> {
    if (!this.systemPrompt) {
      throw new Error('systemPrompt is not set');
    }
    const systemContent = this.systemPrompt;
    const humanContent = `コメント:${comment}\n動画タイトル:${videoTitle}\n動画概要欄:${videoDescription}\nコメントしてくれたユーザーの名前:${authorName}`;
    const response = await this.model.invoke([
      new SystemMessage(systemContent),
      new HumanMessage(humanContent),
    ]);
    return response.content.toString();
  }
}

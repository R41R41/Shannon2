import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { loadPrompt } from '../config/prompts.js';
import { config } from '../../../config/env.js';
import { models } from '../../../config/models.js';

const OPENAI_API_KEY = config.openaiApiKey;
if (!OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set');
}

export class ReplyYoutubeLiveCommentAgent {
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

  public static async create(): Promise<ReplyYoutubeLiveCommentAgent> {
    const prompt = await loadPrompt('reply_youtube_live_comment');
    if (!prompt) {
      throw new Error('Failed to load reply_youtube_live_comment prompt');
    }
    return new ReplyYoutubeLiveCommentAgent(prompt);
  }

  public async reply(
    message: string,
    author: string,
    jstNow: string,
    minutesSinceStart: number | null,
    history: string[],
    liveTitle: string | null,
    liveDescription: string | null
  ): Promise<string> {
    if (!this.systemPrompt) {
      throw new Error('systemPrompt is not set');
    }
    const systemContent = this.systemPrompt;
    const humanContent = `コメント:${message}\n動画タイトル:${liveTitle}\n動画概要欄:${liveDescription}\nコメントしてくれたユーザーの名前:${author}\n現在時刻:${jstNow}\n配信開始からの時間:${minutesSinceStart}\n過去のコメント:${history.join(
      '\n'
    )}`;
    const response = await this.model.invoke([
      new SystemMessage(systemContent),
      new HumanMessage(humanContent),
    ]);
    return response.content.toString();
  }
}

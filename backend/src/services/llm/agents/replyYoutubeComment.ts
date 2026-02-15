import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { TaskContext } from '@shannon/common';
import { loadPrompt } from '../config/prompts.js';
import { config } from '../../../config/env.js';
import { models } from '../../../config/models.js';
import { MemoryNode } from '../graph/nodes/MemoryNode.js';
import { IExchange } from '../../../models/PersonMemory.js';

const OPENAI_API_KEY = config.openaiApiKey;
if (!OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set');
}

export class ReplyYoutubeCommentAgent {
  private model: ChatOpenAI;
  private systemPrompt: string;
  private memoryNode: MemoryNode | null = null;

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
    const agent = new ReplyYoutubeCommentAgent(prompt);
    agent.memoryNode = new MemoryNode();
    await agent.memoryNode.initialize();
    return agent;
  }

  public async reply(
    comment: string,
    videoTitle: string,
    videoDescription: string,
    authorName: string,
    authorChannelId?: string | null,
  ): Promise<string> {
    if (!this.systemPrompt) {
      throw new Error('systemPrompt is not set');
    }

    // === 記憶 preProcess ===
    let memoryContext = '';
    const context: TaskContext = {
      platform: 'youtube',
      youtube: {
        channelId: authorChannelId ?? undefined,
      },
    };

    if (this.memoryNode) {
      try {
        const memState = await this.memoryNode.preProcess({
          userMessage: comment,
          context,
        });
        const sections: string[] = [];
        if (memState.person) {
          const p = memState.person;
          if (p.traits.length > 0) sections.push(`この人の特徴: ${p.traits.join(', ')}`);
          if (p.conversationSummary) sections.push(`過去のやりとり: ${p.conversationSummary}`);
        }
        if (sections.length > 0) {
          memoryContext = `\n\n【ボクの記憶】\n${sections.join('\n')}`;
        }
      } catch (error) {
        console.error('❌ YouTube Reply: 記憶取得エラー:', error);
      }
    }

    const systemContent = this.systemPrompt + memoryContext;
    const humanContent = `コメント:${comment}\n動画タイトル:${videoTitle}\n動画概要欄:${videoDescription}\nコメントしてくれたユーザーの名前:${authorName}`;
    const response = await this.model.invoke([
      new SystemMessage(systemContent),
      new HumanMessage(humanContent),
    ]);
    const replyText = response.content.toString();

    // === 記憶 postProcess (fire-and-forget) ===
    if (this.memoryNode && authorChannelId) {
      const exchanges: IExchange[] = [
        { role: 'user', content: comment, timestamp: new Date() },
        { role: 'assistant', content: replyText, timestamp: new Date() },
      ];
      this.memoryNode.postProcess({
        context,
        conversationText: `${authorName}: ${comment}\nシャノン: ${replyText}`,
        exchanges,
      }).catch((err) => {
        console.error('❌ YouTube Reply: 記憶保存エラー:', err);
      });
    }

    return replyText;
  }
}

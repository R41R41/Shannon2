import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { TaskContext } from '@shannon/common';
import { loadPrompt } from '../config/prompts.js';
import { config } from '../../../config/env.js';
import { models } from '../../../config/models.js';
import { createTracedModel } from '../utils/langfuse.js';
import { MemoryNode } from '../graph/nodes/MemoryNode.js';
import { IExchange } from '../../../models/PersonMemory.js';
import { logger } from '../../../utils/logger.js';

const OPENAI_API_KEY = config.openaiApiKey;
if (!OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set');
}

export class ReplyYoutubeLiveCommentAgent {
  private model: ChatOpenAI;
  private systemPrompt: string;
  private memoryNode: MemoryNode | null = null;

  private constructor(systemPrompt: string) {
    const isGemini = models.contentGeneration.startsWith('gemini');
    const isReasoning = models.contentGeneration.startsWith('gpt-5') || models.contentGeneration.startsWith('o');
    this.model = createTracedModel({
      modelName: models.contentGeneration,
      ...(isReasoning
        ? { modelKwargs: { max_completion_tokens: 4096 } }
        : isGemini
          ? { maxTokens: 8192 }
          : { temperature: 1 }),
      ...(isGemini
        ? {
            timeout: 300000,
            configuration: {
              baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
              apiKey: config.google.geminiApiKey,
            },
            apiKey: config.google.geminiApiKey,
          }
        : { apiKey: OPENAI_API_KEY }),
    });
    this.systemPrompt = systemPrompt;
  }

  public static async create(): Promise<ReplyYoutubeLiveCommentAgent> {
    const prompt = await loadPrompt('reply_youtube_live_comment');
    if (!prompt) {
      throw new Error('Failed to load reply_youtube_live_comment prompt');
    }
    const agent = new ReplyYoutubeLiveCommentAgent(prompt);
    agent.memoryNode = new MemoryNode();
    await agent.memoryNode.initialize();
    return agent;
  }

  public async reply(
    message: string,
    author: string,
    jstNow: string,
    minutesSinceStart: number | null,
    history: string[],
    liveTitle: string | null,
    liveDescription: string | null,
    authorChannelId?: string | null,
  ): Promise<string> {
    if (!this.systemPrompt) {
      throw new Error('systemPrompt is not set');
    }

    // === 記憶 preProcess ===
    let memoryContext = '';
    const context: TaskContext = {
      platform: 'youtube:live_chat' as any,
      youtube: {
        channelId: authorChannelId ?? undefined,
      },
    };

    if (this.memoryNode && authorChannelId) {
      try {
        const memState = await this.memoryNode.preProcess({
          userMessage: message,
          context: { ...context, platform: 'youtube' },
        });
        const sections: string[] = [];
        if (memState.person) {
          const p = memState.person;
          if (p.traits.length > 0) sections.push(`この人の特徴: ${p.traits.join(', ')}`);
        }
        if (sections.length > 0) {
          memoryContext = `\n\n【ボクの記憶】\n${sections.join('\n')}`;
        }
      } catch (error) {
        logger.error('❌ YouTube Live Reply: 記憶取得エラー:', error);
      }
    }

    const systemContent = this.systemPrompt + memoryContext;
    const humanContent = `コメント:${message}\n動画タイトル:${liveTitle}\n動画概要欄:${liveDescription}\nコメントしてくれたユーザーの名前:${author}\n現在時刻:${jstNow}\n配信開始からの時間:${minutesSinceStart}\n過去のコメント:${history.join(
      '\n'
    )}`;
    const response = await this.model.invoke([
      new SystemMessage(systemContent),
      new HumanMessage(humanContent),
    ]);
    const replyText = response.content.toString();

    // === 記憶 postProcess (fire-and-forget) ===
    if (this.memoryNode && authorChannelId) {
      const exchanges: IExchange[] = [
        { role: 'user', content: message, timestamp: new Date() },
        { role: 'assistant', content: replyText, timestamp: new Date() },
      ];
      this.memoryNode.postProcess({
        context: { ...context, platform: 'youtube' },
        conversationText: `${author}: ${message}\nシャノン: ${replyText}`,
        exchanges,
      }).catch((err) => {
        logger.error('❌ YouTube Live Reply: 記憶保存エラー:', err);
      });
    }

    return replyText;
  }
}

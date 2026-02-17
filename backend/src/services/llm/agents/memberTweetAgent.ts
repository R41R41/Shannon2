import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { TaskContext } from '@shannon/common';
import { z } from 'zod';
import { config } from '../../../config/env.js';
import { models } from '../../../config/models.js';
import { IExchange } from '../../../models/PersonMemory.js';
import { logger } from '../../../utils/logger.js';
import { loadPrompt } from '../config/prompts.js';
import { MemoryNode } from '../graph/nodes/MemoryNode.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemberTweetResult {
  type: 'reply' | 'quote_rt';
  text: string;
}

// ---------------------------------------------------------------------------
// Tool 1: submit_reply
// ---------------------------------------------------------------------------

class SubmitReplyTool extends StructuredTool {
  name = 'submit_reply';
  description =
    '個人的な会話・雑談・ツッコミなど、直接返信が適切な場合に使う。';
  schema = z.object({
    text: z.string().describe('返信テキスト（140文字以内）'),
  });

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    return JSON.stringify({ type: 'reply', text: data.text });
  }
}

// ---------------------------------------------------------------------------
// Tool 2: submit_quote_rt
// ---------------------------------------------------------------------------

class SubmitQuoteRTTool extends StructuredTool {
  name = 'submit_quote_rt';
  description =
    '成果報告・告知・フォロワーに共有したい話題など、引用リツイートが適切な場合に使う。';
  schema = z.object({
    text: z.string().describe('引用RTのコメント（140文字以内）'),
  });

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    return JSON.stringify({ type: 'quote_rt', text: data.text });
  }
}

// ---------------------------------------------------------------------------
// MemberTweetAgent
// ---------------------------------------------------------------------------

const MAX_ITERATIONS = 3;

export class MemberTweetAgent {
  private systemPrompt: string;
  private tools: StructuredTool[];
  private toolMap: Map<string, StructuredTool>;
  private memoryNode: MemoryNode | null = null;

  private constructor(systemPrompt: string) {
    this.systemPrompt = systemPrompt;
    this.tools = [new SubmitReplyTool(), new SubmitQuoteRTTool()];
    this.toolMap = new Map(this.tools.map((t) => [t.name, t]));
  }

  public static async create(): Promise<MemberTweetAgent> {
    const systemPrompt = await loadPrompt('respond_member_tweet');
    if (!systemPrompt)
      throw new Error('Failed to load respond_member_tweet prompt');

    const agent = new MemberTweetAgent(systemPrompt);
    agent.memoryNode = new MemoryNode();
    await agent.memoryNode.initialize();
    return agent;
  }

  // =========================================================================
  // Public: メインエントリポイント
  // =========================================================================

  public async respond(params: {
    text: string;
    authorName: string;
    authorUserName: string;
    authorId?: string | null;
    repliedTweet?: string | null;
    repliedTweetAuthorName?: string | null;
    conversationThread?: Array<{ authorName: string; text: string }> | null;
  }): Promise<MemberTweetResult | null> {
    const {
      text,
      authorName,
      authorUserName,
      authorId,
      repliedTweet,
      repliedTweetAuthorName,
      conversationThread,
    } = params;

    // === 記憶 preProcess ===
    let memoryContext = '';
    const taskContext: TaskContext = {
      platform: 'twitter',
      twitter: {
        authorId: authorId ?? authorName,
        authorName,
      },
    };

    if (this.memoryNode) {
      try {
        const memState = await this.memoryNode.preProcess({
          userMessage: text,
          context: taskContext,
        });
        const sections: string[] = [];
        if (memState.person) {
          const p = memState.person;
          if (p.traits.length > 0)
            sections.push(`この人の特徴: ${p.traits.join(', ')}`);
          if (p.conversationSummary)
            sections.push(`過去のやりとり: ${p.conversationSummary}`);
        }
        if (memState.experiences.length > 0) {
          sections.push(
            '関連する体験: ' +
              memState.experiences.map((e) => e.content).join('; '),
          );
        }
        if (sections.length > 0) {
          memoryContext = `\n\n【ボクの記憶】\n${sections.join('\n')}`;
        }
      } catch (error) {
        logger.error('❌ MemberTweet: 記憶取得エラー:', error);
      }
    }

    // === LLM呼び出し (FCA) ===
    const model = new ChatOpenAI({
      modelName: models.contentGeneration,
      temperature: 1,
    });
    const modelWithTools = model.bindTools(this.tools);

    const systemContent = this.systemPrompt + memoryContext;

    const lines: string[] = [];
    if (conversationThread && conversationThread.length > 0) {
      lines.push('【会話の流れ】');
      for (const msg of conversationThread) {
        lines.push(`${msg.authorName}: ${msg.text}`);
      }
      lines.push('');
      lines.push(
        `【これに対する ${authorName} (@${authorUserName}) の最新投稿（↓あなたが反応する対象）】`,
      );
      lines.push(text);
    } else if (repliedTweet) {
      lines.push(
        `【元ツイート（${repliedTweetAuthorName ?? '不明'}の投稿）】`,
      );
      lines.push(repliedTweet);
      lines.push('');
      lines.push(`【${authorName} (@${authorUserName}) の返信/投稿】`);
      lines.push(text);
    } else {
      lines.push(`【${authorName} (@${authorUserName}) のツイート】`);
      lines.push(text);
    }

    lines.push('');
    lines.push(
      '上記のツイートに対して、submit_reply か submit_quote_rt のどちらかのツールを使って反応してください。',
    );

    const messages: BaseMessage[] = [
      new SystemMessage(systemContent),
      new HumanMessage(lines.join('\n')),
    ];

    let result: MemberTweetResult | null = null;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      let response: AIMessage;
      try {
        response = (await modelWithTools.invoke(messages)) as AIMessage;
      } catch (e: any) {
        logger.error(`[MemberTweet] LLM呼び出しエラー: ${e.message}`);
        return null;
      }
      messages.push(response);

      const toolCalls = response.tool_calls || [];

      if (toolCalls.length === 0) {
        const fallbackText =
          typeof response.content === 'string'
            ? response.content.trim()
            : '';
        if (fallbackText) {
          result = { type: 'reply', text: fallbackText };
        }
        break;
      }

      for (const tc of toolCalls) {
        if (tc.name === 'submit_reply' || tc.name === 'submit_quote_rt') {
          try {
            const toolResult = await this.toolMap.get(tc.name)!.invoke(tc.args);
            const parsed = JSON.parse(toolResult);
            result = {
              type: parsed.type,
              text: parsed.text || '',
            };
          } catch {
            result = null;
          }
          break;
        }

        messages.push(
          new ToolMessage({
            content: `ツール "${tc.name}" は存在しません。submit_reply か submit_quote_rt を使ってください。`,
            tool_call_id: tc.id || `call_${Date.now()}`,
          }),
        );
      }

      if (result) break;
    }

    // === 記憶 postProcess (fire-and-forget) ===
    if (result && this.memoryNode) {
      const exchanges: IExchange[] = [
        { role: 'user', content: text, timestamp: new Date() },
        { role: 'assistant', content: result.text, timestamp: new Date() },
      ];
      this.memoryNode
        .postProcess({
          context: taskContext,
          conversationText: `${authorName}: ${text}\nシャノン: ${result.text}`,
          exchanges,
        })
        .catch((err) => {
          logger.error('❌ MemberTweet: 記憶保存エラー:', err);
        });
    }

    return result;
  }
}

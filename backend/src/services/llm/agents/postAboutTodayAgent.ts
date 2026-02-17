import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { ChatOpenAI } from '@langchain/openai';
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { models } from '../../../config/models.js';
import { loadPrompt } from '../config/prompts.js';
import GoogleSearchTool from '../tools/googleSearch.js';
import SearchByWikipediaTool from '../tools/searchByWikipedia.js';
import { logger } from '../../../utils/logger.js';

const jst = 'Asia/Tokyo';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReviewResult {
  approved: boolean;
  issues: string[];
  viewer_perception: string;
  suggestion: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TOOL_CALLS = 8;
const MAX_EXPLORATION_ITERATIONS = 15;
const MAX_REVIEW_RETRIES = 3;

// ---------------------------------------------------------------------------
// Tool: submit_post (output tool - signals the agent to stop)
// ---------------------------------------------------------------------------

/** エージェントの出力 */
export interface AboutTodayOutput {
  text: string;
  imagePrompt?: string;
}

class SubmitPostTool extends StructuredTool {
  name = 'submit_post';
  description =
    '調査が完了したら、このツールで最終的な「今日は何の日」ツイートを提出する。画像プロンプトも添えること。';
  schema = z.object({
    text: z.string().describe('ツイート本文（【今日は何の日？】ヘッダーは不要）'),
    imagePrompt: z
      .string()
      .describe(
        'ツイート内容に合った画像を生成するためのプロンプト（英語）。例: "A cute anime-style AI character looking at diamond dust sparkling in the cold winter air, northern Hokkaido landscape, soft pastel colors, illustration style"',
      ),
  });

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    return JSON.stringify(data);
  }
}

// ---------------------------------------------------------------------------
// PostAboutTodayAgent
// ---------------------------------------------------------------------------

export class PostAboutTodayAgent {
  private systemPrompt: string;
  private reviewPrompt: string;
  private tools: StructuredTool[];
  private toolMap: Map<string, StructuredTool>;

  private constructor(systemPrompt: string, reviewPrompt: string) {
    this.systemPrompt = systemPrompt;
    this.reviewPrompt = reviewPrompt;

    this.tools = [
      new GoogleSearchTool(),
      new SearchByWikipediaTool(),
      new SubmitPostTool(),
    ];
    this.toolMap = new Map(this.tools.map((t) => [t.name, t]));
  }

  public static async create(): Promise<PostAboutTodayAgent> {
    const systemPrompt = await loadPrompt('about_today');
    if (!systemPrompt) throw new Error('Failed to load about_today prompt');

    const reviewPrompt = await loadPrompt('about_today_review');
    if (!reviewPrompt)
      throw new Error('Failed to load about_today_review prompt');

    return new PostAboutTodayAgent(systemPrompt, reviewPrompt);
  }

  // =========================================================================
  // Public: メインエントリポイント（後方互換のインターフェース）
  // =========================================================================

  public async createPost(): Promise<AboutTodayOutput> {
    const today = this.getTodayDate();
    let feedback: string | undefined;

    for (let attempt = 1; attempt <= MAX_REVIEW_RETRIES; attempt++) {
      logger.info(
        `[AboutToday] 探索+生成 (試行 ${attempt}/${MAX_REVIEW_RETRIES})`,
        'cyan',
      );

      const draft = await this.explore(today, feedback);
      if (!draft) {
        logger.warn('[AboutToday] 探索結果なし、リトライ');
        feedback = '前回は調査に失敗した。別のトピックを選んでもっと詳しく調べて。';
        continue;
      }

      logger.info(
        `[AboutToday] ドラフト: "${draft.text.slice(0, 80)}..."`,
        'cyan',
      );

      const review = await this.review(draft.text);
      if (review.approved) {
        logger.info('[AboutToday] レビュー合格', 'green');
        return {
          text: `【今日は何の日？】\n${draft.text}`,
          imagePrompt: draft.imagePrompt,
        };
      }

      logger.warn(
        `[AboutToday] レビュー不合格: ${review.issues.join(', ')}`,
      );
      feedback = [
        `前回の投稿「${draft.text.slice(0, 100)}...」は以下の理由で不合格:`,
        ...review.issues.map((i) => `- ${i}`),
        review.suggestion ? `提案: ${review.suggestion}` : '',
        '別のアプローチでもう一度書いてください。',
      ].join('\n');
    }

    logger.warn('[AboutToday] 3回リトライ失敗、フォールバック');
    const fallback = await this.explore(today);
    return {
      text: `【今日は何の日？】\n${fallback?.text || '今日も何かの記念日かも…調べてみたけどうまく見つけられなかった'}`,
      imagePrompt: fallback?.imagePrompt,
    };
  }

  // =========================================================================
  // Phase 1: 探索 (Function Calling Agent)
  // =========================================================================

  private async explore(
    today: string,
    feedback?: string,
  ): Promise<AboutTodayOutput | null> {
    const model = new ChatOpenAI({
      modelName: models.autoTweet,
      temperature: 0.8,
    });
    const modelWithTools = model.bindTools(this.tools);

    const [year, month, day] = today.split('-');
    const dateText = `${parseInt(month)}月${parseInt(day)}日`;

    const userContent = [
      `# 今日の日付`,
      `${today}（${dateText}）`,
      '',
      `まず「${dateText} 何の日」で Google 検索して候補を把握し、`,
      `面白そうなトピックを1つ選んだら Wikipedia で詳しく調べてください。`,
      `十分に調べたら submit_post でツイートを提出してください。`,
      feedback ? `\n# 前回のフィードバック\n${feedback}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const messages: BaseMessage[] = [
      new SystemMessage(this.systemPrompt),
      new HumanMessage(userContent),
    ];

    let toolCallCount = 0;

    for (let i = 0; i < MAX_EXPLORATION_ITERATIONS; i++) {
      let response: AIMessage;
      try {
        response = (await modelWithTools.invoke(messages)) as AIMessage;
      } catch (e: any) {
        logger.error(`[AboutToday] LLM呼び出しエラー: ${e.message}`);
        return null;
      }
      messages.push(response);

      const toolCalls = response.tool_calls || [];

      if (toolCalls.length === 0) {
        const text =
          typeof response.content === 'string'
            ? response.content.trim()
            : '';
        if (text) return { text };
        return null;
      }

      for (const tc of toolCalls) {
        if (tc.name === 'submit_post') {
          try {
            const result = await this.toolMap.get(tc.name)!.invoke(tc.args);
            const parsed = JSON.parse(result);
            if (!parsed.text) return null;
            return {
              text: parsed.text,
              imagePrompt: parsed.imagePrompt,
            };
          } catch {
            return null;
          }
        }

        if (toolCallCount >= MAX_TOOL_CALLS) {
          messages.push(
            new ToolMessage({
              content:
                'ツール呼び出し上限に達しました。submit_post で最終的なツイートを提出してください。',
              tool_call_id: tc.id || `call_${Date.now()}`,
            }),
          );
          continue;
        }

        const tool = this.toolMap.get(tc.name);
        if (!tool) {
          messages.push(
            new ToolMessage({
              content: `ツール "${tc.name}" は存在しません`,
              tool_call_id: tc.id || `call_${Date.now()}`,
            }),
          );
          continue;
        }

        try {
          logger.debug(
            `[AboutToday] Tool: ${tc.name}(${JSON.stringify(tc.args).slice(0, 120)})`,
          );
          const result = await tool.invoke(tc.args);
          const resultStr =
            typeof result === 'string' ? result : JSON.stringify(result);
          messages.push(
            new ToolMessage({
              content: resultStr.slice(0, 6000),
              tool_call_id: tc.id || `call_${Date.now()}`,
            }),
          );
          toolCallCount++;
        } catch (e: any) {
          messages.push(
            new ToolMessage({
              content: `ツール実行エラー: ${e.message}`,
              tool_call_id: tc.id || `call_${Date.now()}`,
            }),
          );
        }
      }
    }

    logger.warn('[AboutToday] 探索イテレーション上限到達');
    return null;
  }

  // =========================================================================
  // Phase 2: レビュー
  // =========================================================================

  private async review(draft: string): Promise<ReviewResult> {
    const model = new ChatOpenAI({
      modelName: models.autoTweet,
      temperature: 0,
    });

    const messages = [
      new SystemMessage(this.reviewPrompt),
      new HumanMessage(
        `以下の「今日は何の日」ツイート案を審査してください。JSON形式で結果を返してください。\n\nツイート: "${draft}"`,
      ),
    ];

    try {
      const response = await model.invoke(messages);
      const text =
        typeof response.content === 'string' ? response.content.trim() : '';

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn(
          `[AboutToday] レビューJSON解析失敗: ${text.slice(0, 200)}`,
        );
        return {
          approved: true,
          issues: [],
          viewer_perception: '',
          suggestion: '',
        };
      }

      const parsed = JSON.parse(jsonMatch[0]) as ReviewResult;
      return {
        approved: parsed.approved ?? true,
        issues: parsed.issues ?? [],
        viewer_perception: parsed.viewer_perception ?? '',
        suggestion: parsed.suggestion ?? '',
      };
    } catch (e: any) {
      logger.error(`[AboutToday] レビューエラー: ${e.message}`);
      return {
        approved: true,
        issues: [],
        viewer_perception: '',
        suggestion: '',
      };
    }
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private getTodayDate(): string {
    const today = new Date();
    return format(toZonedTime(today, jst), 'yyyy-MM-dd');
  }
}

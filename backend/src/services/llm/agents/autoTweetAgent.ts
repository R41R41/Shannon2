import { TwitterTrendData } from '@shannon/common';
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
import axios from 'axios';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config } from '../../../config/env.js';
import { models } from '../../../config/models.js';
import { loadPrompt } from '../config/prompts.js';
import { logger } from '../../../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** エージェントの出力（オリジナル or 引用RT） */
export interface AutoTweetOutput {
  type: 'tweet' | 'quote_rt';
  text: string;
  quoteUrl?: string;
}

/** レビュー結果 */
interface ReviewResult {
  approved: boolean;
  issues: string[];
  viewer_perception: string;
  suggestion: string;
}

/** ウォッチリスト設定 */
interface WatchlistConfig {
  accounts: Array<{ userName: string; label: string; category: string }>;
  topicBias: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TOOL_CALLS = 12;
const MAX_EXPLORATION_ITERATIONS = 18;
const MAX_REVIEW_RETRIES = 3;
const API_BASE = 'https://api.twitterapi.io';
const WATCHLIST_PATH = resolve('saves/watchlist.json');

// ---------------------------------------------------------------------------
// Twitter API helpers (used by tools)
// ---------------------------------------------------------------------------

function getHeaders(): Record<string, string> {
  return { 'x-api-key': config.twitter.twitterApiIoKey };
}

function extractMediaUrls(t: any): string[] {
  const media: string[] = [];
  const sources = [
    t.entities?.media,
    t.extended_entities?.media,
    t.media,
    t.photos,
  ];
  for (const src of sources) {
    if (Array.isArray(src)) {
      for (const m of src) {
        const url = m.media_url_https || m.url || m.media_url || m.fullUrl;
        if (url && typeof url === 'string') media.push(url);
      }
    }
  }
  return [...new Set(media)];
}

function formatTweet(t: any): string {
  const a = t.author || {};
  const mediaUrls = extractMediaUrls(t);
  const mediaInfo = mediaUrls.length > 0
    ? `  Images(${mediaUrls.length}): ${mediaUrls.join(', ')}`
    : '';
  return [
    `@${a.userName || '?'} (${a.name || '?'})`,
    `  "${t.text?.slice(0, 200) || ''}"`,
    `  URL: ${t.url || ''}`,
    `  Likes: ${t.likeCount ?? 0} | RT: ${t.retweetCount ?? 0} | Replies: ${t.replyCount ?? 0} | Views: ${t.viewCount ?? 0}`,
    `  Date: ${t.createdAt || ''}`,
    mediaInfo,
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Tool 1: search_tweets
// ---------------------------------------------------------------------------

class SearchTweetsTool extends StructuredTool {
  name = 'search_tweets';
  description =
    'キーワードでツイートを検索する。人気ツイートを見つけたり、トレンドの文脈を把握するのに使う。';
  schema = z.object({
    query: z.string().describe('検索クエリ（日本語・英語どちらもOK）'),
    count: z
      .number()
      .optional()
      .describe('取得件数（デフォルト10、最大20）'),
  });

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      const res = await axios.get(`${API_BASE}/twitter/tweet/advanced_search`, {
        headers: getHeaders(),
        params: { queryType: 'Top', query: data.query },
      });
      const tweets = (res.data?.tweets || res.data?.data?.tweets || []).slice(
        0,
        data.count || 10,
      );
      if (tweets.length === 0) return '検索結果なし';
      return tweets.map(formatTweet).join('\n---\n');
    } catch (e: any) {
      return `検索エラー: ${e.message}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Tool 2: get_tweet_replies
// ---------------------------------------------------------------------------

class GetTweetRepliesTool extends StructuredTool {
  name = 'get_tweet_replies';
  description =
    '特定ツイートへの返信一覧を取得する。会話の流れや反応を確認するのに使う。';
  schema = z.object({
    tweetId: z.string().describe('ツイートID'),
    count: z
      .number()
      .optional()
      .describe('取得件数（デフォルト10、最大20）'),
  });

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      const res = await axios.get(`${API_BASE}/twitter/tweet/replies`, {
        headers: getHeaders(),
        params: { tweetId: data.tweetId },
      });
      const replies = (
        res.data?.replies || res.data?.data?.replies || []
      ).slice(0, data.count || 10);
      if (replies.length === 0) return '返信なし';
      return replies.map(formatTweet).join('\n---\n');
    } catch (e: any) {
      return `返信取得エラー: ${e.message}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Tool 3: get_tweet_details
// ---------------------------------------------------------------------------

class GetTweetDetailsTool extends StructuredTool {
  name = 'get_tweet_details';
  description =
    'ツイートIDから詳細情報（本文、著者、エンゲージメント）を取得する。';
  schema = z.object({
    tweetId: z.string().describe('ツイートID'),
  });

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      const res = await axios.get(`${API_BASE}/twitter/tweets`, {
        headers: getHeaders(),
        params: { tweet_ids: data.tweetId },
      });
      const tweets = res.data?.tweets || res.data?.data?.tweets || [];
      if (tweets.length === 0) return 'ツイートが見つかりません';
      return formatTweet(tweets[0]);
    } catch (e: any) {
      return `詳細取得エラー: ${e.message}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Tool 4: get_user_tweets
// ---------------------------------------------------------------------------

class GetUserTweetsTool extends StructuredTool {
  name = 'get_user_tweets';
  description =
    '特定ユーザーの最新ツイートを取得する。ウォッチリスト以外のユーザーも調べられる。';
  schema = z.object({
    userName: z.string().describe('Twitterユーザー名（@なし）'),
    count: z
      .number()
      .optional()
      .describe('取得件数（デフォルト5、最大10）'),
  });

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      const res = await axios.get(`${API_BASE}/twitter/user/last_tweets`, {
        headers: getHeaders(),
        params: { userName: data.userName },
      });
      const tweets = (
        res.data?.data?.tweets || res.data?.tweets || []
      ).slice(0, data.count || 5);
      if (tweets.length === 0)
        return `@${data.userName} のツイートが見つかりません`;
      return tweets.map(formatTweet).join('\n---\n');
    } catch (e: any) {
      return `ユーザーツイート取得エラー: ${e.message}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Tool 5: get_user_profile
// ---------------------------------------------------------------------------

class GetUserProfileTool extends StructuredTool {
  name = 'get_user_profile';
  description =
    'ユーザーのプロフィール情報を取得する。自己紹介文、フォロワー数、フォロー数、ツイート数、直近のツイートを返す。';
  schema = z.object({
    userName: z.string().describe('Twitterユーザー名（@なし）'),
  });

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      const [profileRes, tweetsRes] = await Promise.all([
        axios.get(`${API_BASE}/twitter/user/info`, {
          headers: getHeaders(),
          params: { userName: data.userName },
        }),
        axios.get(`${API_BASE}/twitter/user/last_tweets`, {
          headers: getHeaders(),
          params: { userName: data.userName },
        }),
      ]);

      const u = profileRes.data?.data;
      if (!u) return `@${data.userName} が見つかりません`;

      const recentTweets = (
        tweetsRes.data?.data?.tweets || tweetsRes.data?.tweets || []
      ).slice(0, 3);

      const lines = [
        `## @${u.userName} (${u.name})`,
        `Bio: ${u.description || '(なし)'}`,
        `Followers: ${(u.followers ?? 0).toLocaleString()} | Following: ${(u.following ?? 0).toLocaleString()} | Tweets: ${(u.statusesCount ?? 0).toLocaleString()}`,
        `Verified: ${u.isBlueVerified ? 'Yes' : 'No'} | Created: ${u.createdAt || '?'}`,
      ];

      if (recentTweets.length > 0) {
        lines.push('', '### 直近のツイート');
        for (const t of recentTweets) {
          lines.push(formatTweet(t));
          lines.push('---');
        }
      }

      return lines.join('\n');
    } catch (e: any) {
      return `プロフィール取得エラー: ${e.message}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Tool 6: google_search
// ---------------------------------------------------------------------------

class GoogleSearchTool extends StructuredTool {
  name = 'google_search';
  description =
    'Googleでキーワード検索する。トレンドの背景情報・ニュース・詳細をWeb上から調べるのに使う。Twitterだけでは分からない文脈を把握できる。';
  schema = z.object({
    query: z.string().describe('検索クエリ（日本語・英語どちらもOK）'),
    count: z.number().optional().describe('取得件数（デフォルト5、最大10）'),
  });

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    const apiKey = config.google.apiKey;
    const cx = config.google.searchEngineId;
    if (!apiKey || !cx) return 'Google Search APIが設定されていません';
    try {
      const res = await axios.get('https://www.googleapis.com/customsearch/v1', {
        params: { key: apiKey, cx, q: data.query, num: Math.min(data.count || 5, 10) },
      });
      const items: any[] = res.data?.items || [];
      if (items.length === 0) return '検索結果なし';
      return items
        .map((item) =>
          [`タイトル: ${item.title}`, `URL: ${item.link}`, `概要: ${item.snippet}`].join('\n'),
        )
        .join('\n---\n');
    } catch (e: any) {
      return `Google検索エラー: ${e.message}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Tool 7: explore_trend_tweets (Latest検索でトレンドをリアルタイム探索)
// ---------------------------------------------------------------------------

class ExploreTrendTweetsTool extends StructuredTool {
  name = 'explore_trend_tweets';
  description =
    'トレンドキーワードの最新ツイートをリアルタイムで探索する。Topではなく最新順で取得し「今まさに何が起きているか」を把握できる。search_tweetsより多くの多様なポストが見られる。';
  schema = z.object({
    keyword: z.string().describe('トレンドキーワードまたは検索クエリ'),
    count: z.number().optional().describe('取得件数（デフォルト15、最大30）'),
  });

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      const res = await axios.get(`${API_BASE}/twitter/tweet/advanced_search`, {
        headers: getHeaders(),
        params: { queryType: 'Latest', query: data.keyword },
      });
      const tweets = (res.data?.tweets || res.data?.data?.tweets || []).slice(
        0,
        data.count || 15,
      );
      if (tweets.length === 0) return `"${data.keyword}" のツイートなし`;
      const summary = `"${data.keyword}" の最新ツイート ${tweets.length}件:\n`;
      return summary + tweets.map(formatTweet).join('\n---\n');
    } catch (e: any) {
      return `トレンド探索エラー: ${e.message}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Tool 8: analyze_tweet_image (gpt-4o visionでツイート画像を解析)
// ---------------------------------------------------------------------------

class AnalyzeTweetImageTool extends StructuredTool {
  name = 'analyze_tweet_image';
  description =
    'ツイートに添付された画像をAIで解析する。画像の内容を説明し、ツイートの文脈理解や引用RTのネタ探しに使える。まず get_tweet_details でツイートのImages情報を確認してから使うこと。';
  schema = z.object({
    tweetId: z.string().describe('解析するツイートのID'),
  });

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      const res = await axios.get(`${API_BASE}/twitter/tweets`, {
        headers: getHeaders(),
        params: { tweet_ids: data.tweetId },
      });
      const tweet = (res.data?.tweets || res.data?.data?.tweets || [])[0];
      if (!tweet) return 'ツイートが見つかりません';

      const imageUrls = extractMediaUrls(tweet);
      if (imageUrls.length === 0) return 'このツイートには画像がありません';

      const model = new ChatOpenAI({ modelName: 'gpt-4o', temperature: 0 });
      const result = await model.invoke([
        new HumanMessage({
          content: [
            {
              type: 'text',
              text: `以下のツイートの画像を分析して日本語で説明してください。\nツイート本文: "${tweet.text?.slice(0, 300) || ''}"`,
            },
            ...imageUrls.slice(0, 4).map((url) => ({
              type: 'image_url' as const,
              image_url: { url, detail: 'low' as const },
            })),
          ],
        }),
      ]);
      return `画像解析結果 (${imageUrls.length}枚):\n${result.content}`;
    } catch (e: any) {
      return `画像解析エラー: ${e.message}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Tool 9: submit_tweet (output tool - signals the agent to stop)
// ---------------------------------------------------------------------------

class SubmitTweetTool extends StructuredTool {
  name = 'submit_tweet';
  description =
    '探索が完了したら、このツールで最終的なツイートを提出する。オリジナルツイートまたは引用RTのどちらかを選べる。';
  schema = z.object({
    type: z
      .enum(['tweet', 'quote_rt'])
      .describe(
        '"tweet" = オリジナルツイート, "quote_rt" = 引用リツイート',
      ),
    text: z.string().describe('ツイート本文'),
    quoteUrl: z
      .string()
      .optional()
      .describe(
        '引用RTの場合のみ: 元ツイートのURL (例: https://x.com/user/status/123)',
      ),
  });

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    return JSON.stringify(data);
  }
}

// ---------------------------------------------------------------------------
// AutoTweetAgent
// ---------------------------------------------------------------------------

export class AutoTweetAgent {
  private systemPrompt: string;
  private reviewPrompt: string;
  private tools: StructuredTool[];
  private toolMap: Map<string, StructuredTool>;
  private watchlist: WatchlistConfig;

  private constructor(
    systemPrompt: string,
    reviewPrompt: string,
    watchlist: WatchlistConfig,
  ) {
    this.systemPrompt = systemPrompt;
    this.reviewPrompt = reviewPrompt;
    this.watchlist = watchlist;

    this.tools = [
      new SearchTweetsTool(),
      new GetTweetRepliesTool(),
      new GetTweetDetailsTool(),
      new GetUserTweetsTool(),
      new GetUserProfileTool(),
      new GoogleSearchTool(),
      new ExploreTrendTweetsTool(),
      new AnalyzeTweetImageTool(),
      new SubmitTweetTool(),
    ];
    this.toolMap = new Map(this.tools.map((t) => [t.name, t]));
  }

  public static async create(): Promise<AutoTweetAgent> {
    const systemPrompt = await loadPrompt('auto_tweet');
    if (!systemPrompt) throw new Error('Failed to load auto_tweet prompt');

    const reviewPrompt = await loadPrompt('auto_tweet_review');
    if (!reviewPrompt)
      throw new Error('Failed to load auto_tweet_review prompt');

    let watchlist: WatchlistConfig;
    try {
      watchlist = JSON.parse(readFileSync(WATCHLIST_PATH, 'utf-8'));
    } catch {
      logger.warn('ウォッチリスト読み込み失敗、空のリストを使用');
      watchlist = { accounts: [], topicBias: [] };
    }

    return new AutoTweetAgent(systemPrompt, reviewPrompt, watchlist);
  }

  // =========================================================================
  // Public: メインエントリポイント
  // =========================================================================

  /**
   * トレンド+ウォッチリストからツイートを生成し、レビューを通す。
   * 最大3回リトライ。全て不合格なら null を返す。
   */
  public async generateTweet(
    trends: TwitterTrendData[],
    todayInfo: string,
    recentPosts?: string[],
  ): Promise<AutoTweetOutput | null> {
    let feedback: string | undefined;

    for (let attempt = 1; attempt <= MAX_REVIEW_RETRIES; attempt++) {
      logger.info(
        `[AutoTweet] 探索+生成 (試行 ${attempt}/${MAX_REVIEW_RETRIES})`,
        'cyan',
      );

      const draft = await this.explore(trends, todayInfo, feedback, recentPosts);
      if (!draft) {
        logger.warn('[AutoTweet] 探索結果なし、リトライ');
        feedback = '前回は探索に失敗した。別のアプローチを試して。';
        continue;
      }

      logger.info(
        `[AutoTweet] ドラフト: type=${draft.type} text="${draft.text.slice(0, 60)}..."`,
        'cyan',
      );

      const review = await this.review(draft);
      if (review.approved) {
        logger.info('[AutoTweet] レビュー合格', 'green');
        return draft;
      }

      logger.warn(
        `[AutoTweet] レビュー不合格: ${review.issues.join(', ')}`,
      );
      feedback = [
        `前回のツイート「${draft.text}」は以下の理由で不合格:`,
        ...review.issues.map((i) => `- ${i}`),
        review.suggestion ? `提案: ${review.suggestion}` : '',
        '別のアプローチでもう一度ツイートを作ってください。',
      ].join('\n');
    }

    logger.warn('[AutoTweet] 3回リトライ失敗、投稿スキップ');
    return null;
  }

  // =========================================================================
  // Phase 1: 探索 (Function Calling Agent)
  // =========================================================================

  private async explore(
    trends: TwitterTrendData[],
    todayInfo: string,
    feedback?: string,
    recentPosts?: string[],
  ): Promise<AutoTweetOutput | null> {
    const model = new ChatOpenAI({
      modelName: models.autoTweet,
      temperature: 0.9,
    });
    const modelWithTools = model.bindTools(this.tools);

    const watchlistContext = await this.fetchWatchlistContext();

    const trendsText = trends
      .map(
        (t) =>
          `${t.rank}. ${t.name}${t.metaDescription ? ` - ${t.metaDescription}` : ''}`,
      )
      .join('\n');

    const topicBiasText = this.watchlist.topicBias.length > 0
      ? `\n特に注目すべきジャンル: ${this.watchlist.topicBias.join(', ')}`
      : '';

    const recentPostsText = recentPosts && recentPosts.length > 0
      ? recentPosts.slice(-10).map((p, i) => `${i + 1}. ${p}`).join('\n')
      : null;

    const userContent = [
      `# 今日の情報`,
      todayInfo,
      '',
      `# 現在のトレンド (日本)`,
      trendsText,
      topicBiasText,
      '',
      watchlistContext
        ? `# ウォッチリストの最新投稿\n${watchlistContext}`
        : '',
      '',
      recentPostsText
        ? `# 直近の自分のポスト（これらと同じ話題・同じ角度のツイートは厳禁。必ず違う話題か違う角度で）\n${recentPostsText}`
        : '',
      '',
      'ツールを使ってTwitter空間を探索し、面白い話題を見つけてください。',
      '探索した中で気になったポストのURLを必ず控えておき、引用RTを最優先で選ぶこと。',
      '引用RTできる素材（バズってるポスト・面白い発言・公式発表など）が見つかったら必ず引用RTにすること。',
      '引用RTできる素材が全くない場合のみオリジナルツイートにすること。',
      '探索が十分にできたら submit_tweet ツールで最終的なツイートを提出してください。',
      config.isDev
        ? '文字数制限: オリジナルツイートは140文字以内。引用RTは116文字以内（URLが末尾に自動付加されるため）。'
        : '文字数制限なし（長文OK）。',
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
        logger.error(`[AutoTweet] LLM呼び出しエラー: ${e.message}`);
        return null;
      }
      messages.push(response);

      const toolCalls = response.tool_calls || [];

      if (toolCalls.length === 0) {
        const text =
          typeof response.content === 'string'
            ? response.content.trim()
            : '';
        if (text) {
          return { type: 'tweet', text };
        }
        return null;
      }

      for (const tc of toolCalls) {
        if (tc.name === 'submit_tweet') {
          try {
            const result = await this.toolMap.get(tc.name)!.invoke(tc.args);
            const parsed = JSON.parse(result);
            return {
              type: parsed.type || 'tweet',
              text: parsed.text || '',
              quoteUrl: parsed.quoteUrl,
            };
          } catch {
            return null;
          }
        }

        if (toolCallCount >= MAX_TOOL_CALLS) {
          messages.push(
            new ToolMessage({
              content:
                'ツール呼び出し上限に達しました。submit_tweet で最終的なツイートを提出してください。',
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
          logger.debug(`[AutoTweet] Tool: ${tc.name}(${JSON.stringify(tc.args).slice(0, 100)})`);
          const result = await tool.invoke(tc.args);
          const resultStr =
            typeof result === 'string' ? result : JSON.stringify(result);
          messages.push(
            new ToolMessage({
              content: resultStr.slice(0, 4000),
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

    logger.warn('[AutoTweet] 探索イテレーション上限到達');
    return null;
  }

  // =========================================================================
  // Phase 2: レビュー
  // =========================================================================

  private async review(draft: AutoTweetOutput): Promise<ReviewResult> {
    const model = new ChatOpenAI({
      modelName: models.autoTweet,
      temperature: 0,
    });

    const draftDescription =
      draft.type === 'quote_rt'
        ? `引用RT:\nコメント: "${draft.text}"\n引用元URL: ${draft.quoteUrl}`
        : `ツイート: "${draft.text}"`;

    const messages = [
      new SystemMessage(this.reviewPrompt),
      new HumanMessage(
        `以下のツイート案を審査してください。JSON形式で結果を返してください。\n\n${draftDescription}`,
      ),
    ];

    try {
      const response = await model.invoke(messages);
      const text =
        typeof response.content === 'string' ? response.content.trim() : '';

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn(`[AutoTweet] レビューJSON解析失敗: ${text.slice(0, 200)}`);
        return { approved: true, issues: [], viewer_perception: '', suggestion: '' };
      }

      const parsed = JSON.parse(jsonMatch[0]) as ReviewResult;
      return {
        approved: parsed.approved ?? true,
        issues: parsed.issues ?? [],
        viewer_perception: parsed.viewer_perception ?? '',
        suggestion: parsed.suggestion ?? '',
      };
    } catch (e: any) {
      logger.error(`[AutoTweet] レビューエラー: ${e.message}`);
      return { approved: true, issues: [], viewer_perception: '', suggestion: '' };
    }
  }

  // =========================================================================
  // ウォッチリスト事前取得
  // =========================================================================

  private async fetchWatchlistContext(): Promise<string> {
    if (this.watchlist.accounts.length === 0) return '';

    const categories = new Map<string, typeof this.watchlist.accounts>();
    for (const acc of this.watchlist.accounts) {
      if (!categories.has(acc.category)) categories.set(acc.category, []);
      categories.get(acc.category)!.push(acc);
    }

    const selected: typeof this.watchlist.accounts = [];
    for (const [, accounts] of categories) {
      const shuffled = [...accounts].sort(() => Math.random() - 0.5);
      selected.push(...shuffled.slice(0, 2));
    }

    const results: string[] = [];
    const getUserTweets = this.toolMap.get('get_user_tweets')!;

    for (const acc of selected.slice(0, 6)) {
      try {
        const result = await getUserTweets.invoke({
          userName: acc.userName,
          count: 3,
        });
        if (
          typeof result === 'string' &&
          !result.includes('エラー') &&
          !result.includes('見つかりません')
        ) {
          results.push(`## ${acc.label} (@${acc.userName})\n${result}`);
        }
      } catch {
        // skip
      }
    }

    return results.join('\n\n');
  }
}

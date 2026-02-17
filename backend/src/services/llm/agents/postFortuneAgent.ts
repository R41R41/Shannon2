import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { loadPrompt } from '../config/prompts.js';
import { models } from '../../../config/models.js';
import { logger } from '../../../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReviewResult {
  approved: boolean;
  issues: string[];
  viewer_perception: string;
  suggestion: string;
}

/** エージェントの出力 */
export interface FortuneOutput {
  text: string;
  imagePrompt?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_REVIEW_RETRIES = 3;

// ---------------------------------------------------------------------------
// Schema – top3(詳細) + middle8(簡易) + last1(丁寧)
// ---------------------------------------------------------------------------

const DetailedFortuneSchema = z.object({
  rank: z.number(),
  sign: z.string(),
  description: z.string().describe('全体運の説明（2〜3文）'),
  topics: z.array(
    z.object({
      topic: z.string(),
      description: z.string(),
    }),
  ),
  luckyItem: z.string(),
});

const SimpleFortuneSchema = z.object({
  rank: z.number(),
  sign: z.string(),
  oneLiner: z.string().describe('一行の運勢コメント'),
});

const LastFortuneSchema = z.object({
  rank: z.number().describe('必ず 12'),
  sign: z.string(),
  apology: z.string().describe('「ごめんなさい！最下位は〇〇座のあなた」的な導入'),
  description: z.string().describe('なぜ最下位か＋前向きなアドバイス（2〜3文）'),
  luckyItem: z.string(),
});

const FortuneSchema = z.object({
  greeting: z.string().describe('朝の挨拶（ですます調）'),
  topFortunes: z.array(DetailedFortuneSchema).describe('1〜3位の星座（詳細）'),
  middleFortunes: z.array(SimpleFortuneSchema).describe('4〜11位の星座（一行ずつ）'),
  lastFortune: LastFortuneSchema.describe('12位（最下位）の星座（丁寧に）'),
  closing: z.string().describe('締めの一言（ですます調）'),
  imagePrompt: z.string().describe(
    '画像生成用プロンプト（英語）。photorealistic style。星座や宇宙の風景。',
  ),
});

type FortuneResult = z.infer<typeof FortuneSchema>;

// ---------------------------------------------------------------------------
// PostFortuneAgent
// ---------------------------------------------------------------------------

export class PostFortuneAgent {
  private keywords: string[];
  private zodiacSigns: string[];
  private model: ChatOpenAI;
  private systemPrompt: string;
  private reviewPrompt: string;

  constructor(systemPrompt: string, reviewPrompt: string) {
    this.systemPrompt = systemPrompt;
    this.reviewPrompt = reviewPrompt;
    this.zodiacSigns = [
      '牡羊座', '牡牛座', '双子座', '蟹座',
      '獅子座', '乙女座', '天秤座', '蠍座',
      '射手座', '山羊座', '水瓶座', '魚座',
    ];
    this.keywords = [
      '創造性', '忍耐力', '直感', '協調性',
      '情熱', '計画性', 'バランス', '変化',
      '冒険', '責任感', '革新', '共感',
      '自信', '細部', '決断力', '感受性',
      'リーダーシップ', '分析力', '調和', '洞察力',
      '自由', '安定', '適応力', '思いやり',
      '活力', '実用性', '公平さ', '深さ',
      '拡大', '規律', '独創性', '受容性',
      '行動力', '堅実さ', '好奇心', '保護',
      '表現力', '効率', '社交性', '神秘',
      '挑戦', '伝統', '友情', '直感',
      '競争', '忠実', '知性', '夢',
    ];
    this.model = new ChatOpenAI({
      modelName: models.contentGeneration,
      modelKwargs: { max_completion_tokens: 8192 },
    });
  }

  public static async create(): Promise<PostFortuneAgent> {
    const prompt = await loadPrompt('fortune');
    if (!prompt) throw new Error('Failed to load fortune prompt');

    const reviewPrompt = await loadPrompt('fortune_review');
    if (!reviewPrompt) throw new Error('Failed to load fortune_review prompt');

    return new PostFortuneAgent(prompt, reviewPrompt);
  }

  // =========================================================================
  // Public
  // =========================================================================

  public async createPost(): Promise<FortuneOutput> {
    let feedback: string | undefined;

    for (let attempt = 1; attempt <= MAX_REVIEW_RETRIES; attempt++) {
      logger.info(
        `[Fortune] 生成 (試行 ${attempt}/${MAX_REVIEW_RETRIES})`,
        'cyan',
      );

      const result = await this.generate(feedback);
      if (!result) {
        logger.warn('[Fortune] 生成失敗、リトライ');
        feedback = '前回は生成に失敗した。もう一度やり直して。';
        continue;
      }

      const formatted = this.formatFortuneResult(result);
      logger.info(`[Fortune] ドラフト: "${formatted.slice(0, 80)}..."`, 'cyan');

      const review = await this.review(formatted);
      if (review.approved) {
        logger.info('[Fortune] レビュー合格', 'green');
        return {
          text: formatted,
          imagePrompt: result.imagePrompt,
        };
      }

      logger.warn(`[Fortune] レビュー不合格: ${review.issues.join(', ')}`);
      feedback = [
        `前回の投稿は以下の理由で不合格:`,
        ...review.issues.map((i) => `- ${i}`),
        review.suggestion ? `提案: ${review.suggestion}` : '',
        'もう一度生成してください。',
      ].join('\n');
    }

    logger.warn('[Fortune] 3回リトライ失敗、フォールバック');
    const fallback = await this.generate();
    if (fallback) {
      return {
        text: this.formatFortuneResult(fallback),
        imagePrompt: fallback.imagePrompt,
      };
    }
    return { text: '【今日の運勢】\n占いの生成に失敗してしまいました…申し訳ありません。' };
  }

  // =========================================================================
  // Generation
  // =========================================================================

  private async generate(feedback?: string): Promise<FortuneResult | null> {
    const humanContent = this.getFortuneInfo();
    const structuredLLM = this.model.withStructuredOutput(FortuneSchema);

    const messages = [
      new SystemMessage(this.systemPrompt),
      new HumanMessage(
        feedback
          ? `${humanContent}\n\n# 前回のフィードバック\n${feedback}`
          : humanContent,
      ),
    ];

    try {
      return await structuredLLM.invoke(messages);
    } catch (error) {
      logger.error('[Fortune] 生成エラー:', error);
      return null;
    }
  }

  // =========================================================================
  // Review
  // =========================================================================

  private async review(draft: string): Promise<ReviewResult> {
    const model = new ChatOpenAI({
      modelName: models.autoTweet,
      temperature: 0,
    });

    const messages = [
      new SystemMessage(this.reviewPrompt),
      new HumanMessage(
        `以下の占いツイート案を審査してください。JSON形式で結果を返してください。\n\nツイート: "${draft}"`,
      ),
    ];

    try {
      const response = await model.invoke(messages);
      const text =
        typeof response.content === 'string' ? response.content.trim() : '';

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn(`[Fortune] レビューJSON解析失敗: ${text.slice(0, 200)}`);
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
      logger.error(`[Fortune] レビューエラー: ${e.message}`);
      return { approved: true, issues: [], viewer_perception: '', suggestion: '' };
    }
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private getFortuneInfo(): string {
    const shuffledSigns = [...this.zodiacSigns]
      .sort(() => Math.random() - 0.5);
    const zodiacSignsMessage = `星座の順位:\n${shuffledSigns
      .map((sign, index) => `${index + 1}位: ${sign}`)
      .join('\n')}`;
    const selectedKeywords = this.keywords
      .sort(() => Math.random() - 0.5)
      .slice(0, 12);
    const keywordsMessage = `キーワード: ${selectedKeywords.join(', ')}`;
    return `${zodiacSignsMessage}\n\n${keywordsMessage}`;
  }

  private formatFortuneResult(result: FortuneResult): string {
    let out = `【今日の運勢】\n\n${result.greeting}\n\n`;

    // --- Top 3 (詳細) ---
    for (const f of result.topFortunes) {
      const medal = f.rank === 1 ? '🥇' : f.rank === 2 ? '🥈' : '🥉';
      out += `${f.rank}位 ${medal} ${f.sign}\n`;
      out += `${f.description}\n`;
      for (const t of f.topics) {
        const emoji = this.getTopicEmoji(t.topic);
        out += `${t.topic}${emoji}：${t.description}\n`;
      }
      out += `ラッキーアイテム：${f.luckyItem} ✨\n\n`;
    }

    // --- Middle 4〜11 (簡易一行) ---
    for (const f of result.middleFortunes) {
      out += `${f.rank}位 ${f.sign}：${f.oneLiner}\n`;
    }
    out += '\n';

    // --- Last (最下位・丁寧) ---
    const last = result.lastFortune;
    out += `${last.apology}\n`;
    out += `${last.description}\n`;
    out += `ラッキーアイテム：${last.luckyItem} ✨\n\n`;

    out += result.closing;
    return out;
  }

  private getTopicEmoji(topic: string): string {
    const emojiMap: Record<string, string> = {
      '仕事': ' 💼',
      '恋愛': ' ❤️',
      '金運': ' 💰',
      '健康': ' 🏥',
      '学業': ' 📚',
      '趣味': ' 🎨',
      '友情': ' 👫',
      '家庭': ' 🏠',
      '旅行': ' ✈️',
    };
    return emojiMap[topic] || ' ⭐';
  }
}

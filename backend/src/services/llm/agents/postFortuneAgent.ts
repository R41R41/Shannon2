import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import dotenv from 'dotenv';
import { loadPrompt } from '../config/prompts.js';

dotenv.config();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set');
}

// 占い結果のスキーマ定義
const FortuneSchema = z.object({
  greeting: z.string(),
  fortunes: z.array(
    z.object({
      rank: z.number(),
      sign: z.string(),
      description: z.string(),
      topics: z.array(
        z.object({
          topic: z.string(),
          description: z.string(),
        })
      ),
      luckyItem: z.string(),
    })
  ),
  closing: z.string(),
});

// 型定義
type FortuneResult = z.infer<typeof FortuneSchema>;

export class PostFortuneAgent {
  private keywords: string[];
  private zodiacSigns: string[];
  private model: ChatOpenAI;
  private systemPrompt: string;

  constructor(systemPrompt: string) {
    this.systemPrompt = systemPrompt;
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
      modelName: 'gpt-4o',
      temperature: 0.7,
    });
  }

  public static async create(): Promise<PostFortuneAgent> {
    const prompt = await loadPrompt('fortune');
    if (!prompt) {
      throw new Error('Failed to load fortune prompt');
    }
    return new PostFortuneAgent(prompt);
  }

  private getFortuneInfo = async () => {
    const selectedSigns = [...this.zodiacSigns]
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);
    const zodiacSignsMessage = `星座の順位:${selectedSigns
      .map((sign, index) => `${index + 1}位: ${sign}`)
      .join('\n')}`;
    const selectedKeywords = this.keywords
      .sort(() => Math.random() - 0.5)
      .slice(0, 6);
    const keywordsMessage = `キーワード:${selectedKeywords.join(', ')}`;
    return `${zodiacSignsMessage}\n${keywordsMessage}`;
  };

  public async createPost(): Promise<string> {
    if (!this.systemPrompt) {
      throw new Error('systemPrompt is not set');
    }
    const humanContent = await this.getFortuneInfo();

    // 構造化出力を得るためのモデル設定
    const structuredLLM = this.model.withStructuredOutput(FortuneSchema);

    // LLMに問い合わせ
    const response = await structuredLLM.invoke([
      new SystemMessage(this.systemPrompt),
      new HumanMessage(humanContent),
    ]);

    // 構造化された結果を整形して返す
    return this.formatFortuneResult(response);
  }

  // 構造化された占い結果を整形するメソッド
  private formatFortuneResult(result: FortuneResult): string {
    let formattedResult = `【今日の運勢】\n\n${result.greeting}\n\n`;

    // 各星座の運勢を整形
    result.fortunes.forEach(fortune => {
      const rankEmoji = fortune.rank === 1 ? '🥇' : fortune.rank === 2 ? '🥈' : '🥉';

      formattedResult += `${fortune.rank}位 ${rankEmoji}: ${fortune.sign}\n`;
      formattedResult += `${fortune.description}\n`;

      // 各トピックを整形
      fortune.topics.forEach(topic => {
        const topicEmoji = this.getTopicEmoji(topic.topic);
        formattedResult += `${topic.topic}${topicEmoji}：${topic.description}\n`;
      });

      formattedResult += `ラッキーアイテム: ${fortune.luckyItem} ✨\n\n`;
    });

    formattedResult += result.closing;

    return formattedResult;
  }

  // トピックに応じた絵文字を返すヘルパーメソッド
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

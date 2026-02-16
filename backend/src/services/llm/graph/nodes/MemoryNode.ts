import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { config } from '../../../../config/env.js';
import { models } from '../../../../config/models.js';
import { TaskContext } from '@shannon/common';
import { IPersonMemory, MemoryPlatform } from '../../../../models/PersonMemory.js';
import { IShannonMemory } from '../../../../models/ShannonMemory.js';
import {
  PersonMemoryService,
  platformToPrivacyZone,
} from '../../../memory/personMemoryService.js';
import {
  ShannonMemoryService,
  ShannonMemoryInput,
} from '../../../memory/shannonMemoryService.js';
import { IExchange } from '../../../../models/PersonMemory.js';
import {
  resolveMemberByPlatformId,
} from '../../../../config/memberAliases.js';
import { loadPrompt } from '../../config/prompts.js';
import { logger } from '../../../../utils/logger.js';

/**
 * MemoryNode に渡す入力
 */
export interface MemoryNodeInput {
  userMessage: string | null;
  context: TaskContext | null;
}

/**
 * MemoryNode の出力 (FunctionCallingAgent に渡す共有状態)
 */
export interface MemoryState {
  person: IPersonMemory | null;
  experiences: IShannonMemory[];
  knowledge: IShannonMemory[];
}

/**
 * postProcess に渡す入力
 */
export interface PostProcessInput {
  context: TaskContext | null;
  /** ユーザーメッセージとシャノンの応答 */
  conversationText: string;
  /** recentExchanges に追加する会話 */
  exchanges: IExchange[];
}

// キーワードパターン (recall-experience をトリガー: キーワード検索)
const EXPERIENCE_PATTERNS = [
  /前に/,
  /あの時/,
  /覚えてる/,
  /思い出/,
  /また.*したい/,
  /前回/,
  /昔/,
  /この前/,
  /初めて/,
];

// 「今日/昨日/最近 何した？」系 (日付ベースで最新の体験を返す)
const RECENT_ACTIVITY_PATTERNS = [
  /今日.*何.*し/,
  /今日.*何してた/,
  /今日.*何した/,
  /今日.*どう/,
  /昨日.*何.*し/,
  /最近.*何.*し/,
  /最近.*どう/,
  /何してた/,
  /何した(の|？|\?|$)/,
  /何やってた/,
  /どうだった/,
  /どうしてた/,
  /何があった/,
];

// キーワードパターン (recall-knowledge をトリガー)
const KNOWLEDGE_PATTERNS = [
  /知ってる？/,
  /知ってますか/,
  /やり方/,
  /方法/,
  /どうやって/,
  /教えて/,
  /仕組み/,
  /って何/,
  /とは？/,
  /なんだっけ/,
];

/**
 * MemoryNode: 記憶ツール呼び出し判断の専用ノード
 *
 * TaskGraph の実行順序:
 * EmotionNode → MemoryNode.preProcess → FunctionCallingAgent → MemoryNode.postProcess
 *
 * preProcess:
 * - recall-person: userId で確実に取得 (常に実行)
 * - recall-experience / recall-knowledge: メッセージ内容からルールベースで判断
 *
 * postProcess:
 * - 会話から体験・知識を抽出して保存 (FCA が save し忘れた分のフォールバック)
 * - 人物特徴の更新 (非同期)
 */
export class MemoryNode {
  private personService: PersonMemoryService;
  private shannonService: ShannonMemoryService;
  private model: ChatOpenAI;
  private extractMemoriesPrompt: string | null = null;

  constructor() {
    this.personService = PersonMemoryService.getInstance();
    this.shannonService = ShannonMemoryService.getInstance();
    // gpt-5-mini は temperature=1 のみサポート（デフォルト値を使用）
    this.model = new ChatOpenAI({
      modelName: models.contentGeneration,
      apiKey: config.openaiApiKey,
    });
  }

  async initialize(): Promise<void> {
    await this.personService.initialize();
    this.extractMemoriesPrompt = await loadPrompt('extract_memories');
  }

  // ========== preProcess: 会話前 ==========

  /**
   * 会話前に記憶を取得してプロンプト注入用の MemoryState を返す
   */
  async preProcess(input: MemoryNodeInput): Promise<MemoryState> {
    const state: MemoryState = {
      person: null,
      experiences: [],
      knowledge: [],
    };

    try {
      const { platform, userId, displayName } = this.extractIdentity(input.context);

      // 1. recall-person: 常に実行 (userId ベースで確実)
      if (platform && userId) {
        state.person = await this.personService.getOrCreate(
          platform,
          userId,
          displayName ?? 'Unknown',
        );
        logger.info(`💭 MemoryNode: ${state.person.displayName} の記憶を取得 (traits: ${state.person.traits.length}, interactions: ${state.person.totalInteractions})`);
      }

      // 2. recall-experience: メッセージパターンで判断
      if (input.userMessage) {
        if (isRecentActivityQuestion(input.userMessage)) {
          // 「今日何した？」系 → 日付ベースで最新の体験を取得
          state.experiences = await this.shannonService.getRecentImportant(
            'experience',
            5,
          );
          if (state.experiences.length > 0) {
            logger.info(`💭 MemoryNode: 最近の体験 ${state.experiences.length}件を取得（日付ベース）`);
          } else {
            logger.info('💭 MemoryNode: 最近の体験が見つかりませんでした');
          }
        } else if (shouldRecallExperience(input.userMessage)) {
          // 「前にもこんなことあったよね？」系 → キーワード検索
          const keywords = extractKeywords(input.userMessage);
          if (keywords) {
            state.experiences = await this.shannonService.searchExperiences(
              keywords,
              3,
            );
            if (state.experiences.length > 0) {
              logger.info(`💭 MemoryNode: 関連する体験 ${state.experiences.length}件を取得`);
            }
          }
        }
      }

      // 3. recall-knowledge: メッセージパターンで判断
      if (input.userMessage && shouldRecallKnowledge(input.userMessage)) {
        const keywords = extractKeywords(input.userMessage);
        if (keywords) {
          state.knowledge = await this.shannonService.searchKnowledge(
            keywords,
            3,
          );
          if (state.knowledge.length > 0) {
            logger.info(`💭 MemoryNode: 関連する知識 ${state.knowledge.length}件を取得`);
          }
        }
      }
    } catch (error) {
      logger.error('❌ MemoryNode preProcess エラー:', error);
    }

    return state;
  }

  // ========== postProcess: 会話後 ==========

  /**
   * 会話後に記憶を抽出・保存し、人物情報を更新する
   */
  async postProcess(input: PostProcessInput): Promise<void> {
    try {
      const { platform, userId, displayName } = this.extractIdentity(input.context);
      const source = platform ?? 'unknown';

      // 1. 会話から体験・知識を抽出して保存
      if (input.conversationText.trim()) {
        this.extractAndSaveMemories(input.conversationText, source).catch(
          (err) => {
            logger.error('❌ MemoryNode 記憶抽出エラー:', err);
          },
        );
      }

      // 2. 人物記憶を更新 (非同期)
      if (platform && userId && input.exchanges.length > 0) {
        this.personService
          .updateAfterConversation(
            platform,
            userId,
            displayName ?? 'Unknown',
            input.exchanges,
          )
          .catch((err) => {
            logger.error('❌ MemoryNode 人物更新エラー:', err);
          });
      }
    } catch (error) {
      logger.error('❌ MemoryNode postProcess エラー:', error);
    }
  }

  /**
   * 会話テキストから体験・知識を抽出して保存
   */
  private async extractAndSaveMemories(
    conversationText: string,
    source: string,
  ): Promise<void> {
    const systemPrompt =
      this.extractMemoriesPrompt ??
      '会話から記憶すべき体験と知識を JSON で抽出してください。';

    const response = await this.model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(conversationText),
    ]);

    const content = response.content.toString().trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.memories || !Array.isArray(parsed.memories)) return;

      for (const memory of parsed.memories) {
        if (!memory.category || !memory.content || !memory.tags) continue;
        if (memory.importance < 4) continue; // 些細なものはスキップ

        const memoryInput: ShannonMemoryInput = {
          category: memory.category,
          content: memory.content,
          feeling: memory.feeling,
          source,
          importance: memory.importance,
          tags: memory.tags,
        };

        const result = await this.shannonService.saveWithDedup(memoryInput);
        if (result.saved) {
          logger.info(`💭 MemoryNode: [${memory.category}] "${memory.content.substring(0, 40)}" を保存`);
        }
      }
    } catch (error) {
      logger.error('❌ MemoryNode extractAndSaveMemories パースエラー:', error);
    }
  }

  // ========== フォーマット ==========

  /**
   * MemoryState をシステムプロンプト注入用の文字列に変換
   */
  formatForSystemPrompt(state: MemoryState): string {
    const sections: string[] = [];

    // 人物情報
    if (state.person) {
      sections.push(this.personService.formatForPrompt(state.person));
    }

    // シャノンの記憶
    const memoryText = this.shannonService.formatForPrompt(
      state.experiences,
      state.knowledge,
    );
    if (memoryText) {
      sections.push(`## ボクの関連する記憶\n${memoryText}`);
    }

    return sections.join('\n\n');
  }

  // ========== ユーティリティ ==========

  /**
   * TaskContext からプラットフォーム情報を抽出
   */
  private extractIdentity(context: TaskContext | null): {
    platform: MemoryPlatform | null;
    userId: string | null;
    displayName: string | null;
  } {
    if (!context) return { platform: null, userId: null, displayName: null };

    if (context.platform === 'discord' && context.discord) {
      return {
        platform: 'discord',
        userId: context.discord.userId ?? null,
        displayName: context.discord.userName ?? null,
      };
    }

    if (context.platform === 'twitter' && context.twitter) {
      return {
        platform: 'twitter',
        userId: context.twitter.authorId ?? context.twitter.authorName ?? null,
        displayName: context.twitter.authorName ?? null,
      };
    }

    if (context.platform === 'youtube' && context.youtube) {
      return {
        platform: 'youtube',
        userId: context.youtube.channelId ?? null,
        displayName: null,
      };
    }

    if (context.platform === 'minebot') {
      return {
        platform: 'minebot',
        userId: context.metadata?.playerName ?? null,
        displayName: context.metadata?.playerName ?? null,
      };
    }

    return { platform: null, userId: null, displayName: null };
  }
}

// ========== ヘルパー関数 ==========

function shouldRecallExperience(message: string): boolean {
  return EXPERIENCE_PATTERNS.some((p) => p.test(message));
}

function isRecentActivityQuestion(message: string): boolean {
  return RECENT_ACTIVITY_PATTERNS.some((p) => p.test(message));
}

function shouldRecallKnowledge(message: string): boolean {
  return KNOWLEDGE_PATTERNS.some((p) => p.test(message));
}

/**
 * メッセージからキーワードを抽出 (簡易: 3文字以上の単語を抽出)
 */
function extractKeywords(message: string): string {
  // タイムスタンプとユーザー名を除去
  const cleaned = message.replace(/^\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}:\d{2}\s+\S+:\s*/, '');
  // 短い助詞等を除去、3文字以上を抽出
  const words = cleaned
    .split(/[\s、。？！,.\?!]+/)
    .filter((w) => w.length >= 2)
    .slice(0, 5);
  return words.join(' ');
}

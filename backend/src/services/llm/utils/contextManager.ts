/**
 * コンテキストウィンドウの動的管理。
 * トークン数ベースで会話履歴をトリミングし、
 * 古いメッセージをサマリーに圧縮する。
 */
import { BaseMessage, HumanMessage, AIMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('LLM:ContextManager');

const CHARS_PER_TOKEN = 3.5;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function getMessageText(msg: BaseMessage): string {
  return typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
}

export interface ContextConfig {
  maxContextTokens: number;
  reservedForResponse: number;
  summaryPrefix: string;
}

const DEFAULT_CONFIG: ContextConfig = {
  maxContextTokens: 6000,
  reservedForResponse: 2000,
  summaryPrefix: '[以前の会話サマリー]',
};

/**
 * メッセージ配列をトークン上限内にトリミングする。
 * - SystemMessage は常に保持
 * - 最新メッセージを優先的に保持
 * - 古いメッセージはサマリーに圧縮
 */
export function trimContext(
  messages: BaseMessage[],
  config: Partial<ContextConfig> = {},
): BaseMessage[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const budget = cfg.maxContextTokens - cfg.reservedForResponse;
  if (budget <= 0) return messages.slice(-3);

  // SystemMessage を分離
  const system = messages.filter((m) => m instanceof SystemMessage);
  const nonSystem = messages.filter((m) => !(m instanceof SystemMessage));

  const systemTokens = system.reduce((sum, m) => sum + estimateTokens(getMessageText(m)), 0);
  let remaining = budget - systemTokens;

  if (remaining <= 0) return [...system, ...nonSystem.slice(-1)];

  // 最新メッセージから逆順に追加
  const kept: BaseMessage[] = [];
  const dropped: BaseMessage[] = [];

  for (let i = nonSystem.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(getMessageText(nonSystem[i]));
    if (remaining - tokens >= 0) {
      kept.unshift(nonSystem[i]);
      remaining -= tokens;
    } else {
      dropped.unshift(...nonSystem.slice(0, i + 1));
      break;
    }
  }

  // ドロップされたメッセージをサマリー化
  if (dropped.length > 0) {
    const summaryLines = dropped
      .filter((m) => !(m instanceof ToolMessage))
      .map((m) => {
        const role = m instanceof HumanMessage ? 'User' : 'AI';
        const text = getMessageText(m);
        return `${role}: ${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`;
      })
      .slice(-5);

    if (summaryLines.length > 0) {
      const summary = new SystemMessage(
        `${cfg.summaryPrefix}\n${summaryLines.join('\n')}`,
      );
      return [...system, summary, ...kept];
    }
  }

  return [...system, ...kept];
}

/**
 * トークン数を推定して返す（デバッグ用）
 */
export function estimateContextTokens(messages: BaseMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(getMessageText(m)), 0);
}

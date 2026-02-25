/**
 * LLM プロバイダーフォールバック。
 * プライマリが失敗した場合にフォールバックプロバイダーへ自動切替する。
 */
import { ChatOpenAI } from '@langchain/openai';
import { config } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';

interface FallbackConfig {
  primaryModel: string;
  fallbackModel?: string;
  fallbackBaseURL?: string;
  fallbackApiKey?: string;
  maxRetries?: number;
}

export function createLLMWithFallback(cfg: FallbackConfig): ChatOpenAI {
  const primary = new ChatOpenAI({
    modelName: cfg.primaryModel,
    openAIApiKey: config.openaiApiKey,
    maxRetries: cfg.maxRetries ?? 2,
  });

  if (!cfg.fallbackModel) return primary;

  const fallbackApiKey = cfg.fallbackApiKey || config.groq.apiKey || config.google.geminiApiKey;
  if (!fallbackApiKey) return primary;

  const fallback = new ChatOpenAI({
    modelName: cfg.fallbackModel,
    openAIApiKey: fallbackApiKey,
    configuration: cfg.fallbackBaseURL ? { baseURL: cfg.fallbackBaseURL } : undefined,
    maxRetries: 1,
  });

  const originalInvoke = primary.invoke.bind(primary);
  primary.invoke = async (...args: Parameters<typeof primary.invoke>) => {
    try {
      return await originalInvoke(...args);
    } catch (err) {
      logger.warn(`[LLM:Fallback] ${cfg.primaryModel} 失敗、${cfg.fallbackModel} へフォールバック: ${err instanceof Error ? err.message : err}`);
      return fallback.invoke(...args);
    }
  };

  return primary;
}

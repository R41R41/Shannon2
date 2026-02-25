import { logger } from './logger.js';

interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
}

/**
 * 指数バックオフ付きリトライ。
 * Rate Limit (429) エラーの Retry-After ヘッダーも考慮する。
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxRetries = 3, initialDelayMs = 2000, maxDelayMs = 60000, label = 'retry' } = opts;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt === maxRetries) throw err;

      let delayMs: number;
      const retryAfter = err?.rateLimit?.reset
        ? (err.rateLimit.reset * 1000 - Date.now() + 5000)
        : null;

      if (retryAfter && retryAfter > 0) {
        delayMs = Math.min(retryAfter, maxDelayMs);
      } else {
        delayMs = Math.min(initialDelayMs * Math.pow(2, attempt), maxDelayMs);
        delayMs += Math.random() * 1000;
      }

      const is429 = err?.message?.includes('429') || err?.code === 429;
      logger.warn(
        `[${label}] ${is429 ? 'Rate limit' : 'エラー'} (attempt ${attempt + 1}/${maxRetries}), ` +
        `${Math.round(delayMs / 1000)}s 後にリトライ: ${err?.message || err}`
      );

      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('Unreachable');
}

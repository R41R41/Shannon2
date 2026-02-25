import { logger } from './logger.js';

/**
 * fire-and-forget な非同期処理を安全に実行するラッパー。
 * Promise の rejection をキャッチしてログに記録し、
 * unhandled rejection によるプロセスクラッシュを防ぐ。
 *
 * @param label ログ出力時の識別ラベル
 * @param fn    実行する非同期関数
 */
export function safeAsync(label: string, fn: () => Promise<void>): void {
  fn().catch((err) => {
    logger.error(`[safeAsync:${label}] ${err instanceof Error ? err.message : err}`);
  });
}

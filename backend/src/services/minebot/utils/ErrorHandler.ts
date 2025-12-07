/**
 * ErrorHandler
 * エラーハンドリングを統一するユーティリティクラス
 */

import { IErrorHandler } from '../interfaces/index.js';
import { ErrorRecoveryStrategy, MinebotError } from '../types/index.js';

/**
 * エラーハンドラー
 * エラーのログ出力、リカバリー処理、通知などを統一的に管理
 */
export class ErrorHandler implements IErrorHandler {
    private static instance: ErrorHandler;
    private errorListeners: Array<(error: MinebotError) => void> = [];

    private constructor() { }

    public static getInstance(): ErrorHandler {
        if (!ErrorHandler.instance) {
            ErrorHandler.instance = new ErrorHandler();
        }
        return ErrorHandler.instance;
    }

    /**
     * エラーを処理
     */
    handle(error: MinebotError): void {
        // エラー情報をコンソールに出力
        console.error('🚨 Error occurred:', error.toJSON());

        // 登録されたリスナーに通知
        this.errorListeners.forEach(listener => {
            try {
                listener(error);
            } catch (listenerError) {
                console.error('Error in error listener:', listenerError);
            }
        });
    }

    /**
     * エラーリスナーを登録
     */
    addListener(listener: (error: MinebotError) => void): void {
        this.errorListeners.push(listener);
    }

    /**
     * エラーリスナーを削除
     */
    removeListener(listener: (error: MinebotError) => void): void {
        const index = this.errorListeners.indexOf(listener);
        if (index > -1) {
            this.errorListeners.splice(index, 1);
        }
    }

    /**
     * リトライ戦略付きで関数を実行
     */
    async executeWithRetry<T>(
        fn: () => Promise<T>,
        strategy: ErrorRecoveryStrategy
    ): Promise<T> {
        let lastError: MinebotError | null = null;
        let attempt = 0;

        while (attempt < strategy.maxRetries) {
            try {
                return await fn();
            } catch (error) {
                const minebotError = error instanceof MinebotError
                    ? error
                    : new MinebotError(
                        error instanceof Error ? error.message : String(error)
                    );

                lastError = minebotError;
                attempt++;

                if (!strategy.shouldRetry(minebotError)) {
                    throw minebotError;
                }

                if (attempt < strategy.maxRetries) {
                    console.log(
                        `⚠️ Retry attempt ${attempt}/${strategy.maxRetries} after ${strategy.retryDelay}ms`
                    );

                    if (strategy.onRetry) {
                        strategy.onRetry(attempt, minebotError);
                    }

                    // リトライ前に待機
                    await this.sleep(strategy.retryDelay);
                } else {
                    if (strategy.onMaxRetriesReached) {
                        strategy.onMaxRetriesReached(minebotError);
                    }
                }
            }
        }

        throw lastError!;
    }

    /**
     * 非同期処理をエラーハンドリング付きで実行
     */
    async safeExecute<T>(
        fn: () => Promise<T>,
        fallback?: T,
        errorMessage?: string
    ): Promise<T | undefined> {
        try {
            return await fn();
        } catch (error) {
            const minebotError = error instanceof MinebotError
                ? error
                : new MinebotError(
                    errorMessage || (error instanceof Error ? error.message : String(error))
                );

            this.handle(minebotError);

            return fallback;
        }
    }

    /**
     * 待機
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * グローバルなエラーハンドラーインスタンス
 */
export const errorHandler = ErrorHandler.getInstance();

/**
 * デフォルトのリトライ戦略
 */
export const DEFAULT_RETRY_STRATEGY: ErrorRecoveryStrategy = {
    maxRetries: 3,
    retryDelay: 1000,
    shouldRetry: (error) => {
        // LLMエラーや一時的なネットワークエラーはリトライ
        return error.type === 'LLM_ERROR' || error.type === 'HTTP_SERVER_ERROR';
    },
    onRetry: (attemptNumber, error) => {
        console.log(`🔄 Retrying (attempt ${attemptNumber}): ${error.message}`);
    },
    onMaxRetriesReached: (error) => {
        console.error(`❌ Max retries reached for: ${error.message}`);
    },
};


/**
 * IErrorHandler
 * エラーハンドラーのインターフェース定義
 */

import { ErrorRecoveryStrategy, MinebotError } from '../types/index.js';

export interface IErrorHandler {
    /**
     * エラーを処理
     */
    handle(error: MinebotError): void;

    /**
     * エラーリスナーを登録
     */
    addListener(listener: (error: MinebotError) => void): void;

    /**
     * エラーリスナーを削除
     */
    removeListener(listener: (error: MinebotError) => void): void;

    /**
     * リトライ戦略付きで関数を実行
     */
    executeWithRetry<T>(
        fn: () => Promise<T>,
        strategy: ErrorRecoveryStrategy
    ): Promise<T>;

    /**
     * 非同期処理をエラーハンドリング付きで実行
     */
    safeExecute<T>(
        fn: () => Promise<T>,
        fallback?: T,
        errorMessage?: string
    ): Promise<T | undefined>;
}


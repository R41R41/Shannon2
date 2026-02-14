/**
 * Minebot-specific error classes.
 * All extend ShannonError (the application-wide base class).
 */
import { ShannonError, ErrorType } from '../../../errors/base.js';

// Re-export for backward compatibility
export { ErrorType } from '../../../errors/base.js';

/**
 * Minebot base error (extends ShannonError)
 */
export class MinebotError extends ShannonError {
    constructor(
        message: string,
        type: ErrorType = ErrorType.UNKNOWN,
        code?: string,
        metadata?: Record<string, unknown>
    ) {
        super(message, type, code, metadata);
        this.name = 'MinebotError';
    }
}

/**
 * スキル読み込みエラー
 */
export class SkillLoadError extends MinebotError {
    constructor(skillName: string, originalError?: Error) {
        super(
            `Failed to load skill: ${skillName}`,
            ErrorType.SKILL_LOAD,
            'SKILL_LOAD_FAILED',
            { skillName, originalError: originalError?.message }
        );
        this.name = 'SkillLoadError';
    }
}

/**
 * スキル実行エラー
 */
export class SkillExecutionError extends MinebotError {
    constructor(skillName: string, originalError?: Error) {
        super(
            `Failed to execute skill: ${skillName}`,
            ErrorType.SKILL_EXECUTION,
            'SKILL_EXECUTION_FAILED',
            { skillName, originalError: originalError?.message }
        );
        this.name = 'SkillExecutionError';
    }
}

/**
 * HTTPサーバーエラー
 */
export class HttpServerError extends MinebotError {
    constructor(endpoint: string, statusCode?: number, originalError?: Error) {
        super(
            `HTTP server error at ${endpoint}`,
            ErrorType.HTTP_SERVER,
            'HTTP_SERVER_ERROR',
            { endpoint, statusCode, originalError: originalError?.message }
        );
        this.name = 'HttpServerError';
    }
}

/**
 * 設定エラー
 */
export class ConfigError extends MinebotError {
    constructor(configKey: string, reason?: string) {
        super(
            `Configuration error: ${configKey}${reason ? ` - ${reason}` : ''}`,
            ErrorType.CONFIG,
            'CONFIG_ERROR',
            { configKey, reason }
        );
        this.name = 'ConfigError';
    }
}

/**
 * LLMエラー
 */
export class LLMError extends MinebotError {
    constructor(phase: string, originalError?: Error) {
        super(
            `LLM error in ${phase} phase`,
            ErrorType.LLM,
            'LLM_ERROR',
            { phase, originalError: originalError?.message }
        );
        this.name = 'LLMError';
    }
}

/**
 * Minecraftエラー
 */
export class MinecraftError extends MinebotError {
    constructor(action: string, originalError?: Error) {
        super(
            `Minecraft action failed: ${action}`,
            ErrorType.MINECRAFT,
            'MINECRAFT_ERROR',
            { action, originalError: originalError?.message }
        );
        this.name = 'MinecraftError';
    }
}

/**
 * エラーハンドラーの型
 */
export type ErrorHandler = (error: MinebotError) => void | Promise<void>;

/**
 * エラーリカバリー戦略
 */
export interface ErrorRecoveryStrategy {
    maxRetries: number;
    retryDelay: number; // ミリ秒
    shouldRetry: (error: MinebotError) => boolean;
    onRetry?: (attemptNumber: number, error: MinebotError) => void;
    onMaxRetriesReached?: (error: MinebotError) => void;
}


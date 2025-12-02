/**
 * エラー関連の型定義とカスタムエラークラス
 */

/**
 * エラータイプ
 */
export enum ErrorType {
    SKILL_LOAD = 'SKILL_LOAD_ERROR',
    SKILL_EXECUTION = 'SKILL_EXECUTION_ERROR',
    HTTP_SERVER = 'HTTP_SERVER_ERROR',
    CONFIG = 'CONFIG_ERROR',
    LLM = 'LLM_ERROR',
    MINECRAFT = 'MINECRAFT_ERROR',
    UNKNOWN = 'UNKNOWN_ERROR',
}

/**
 * 基底エラークラス
 */
export class MinebotError extends Error {
    public readonly type: ErrorType;
    public readonly code?: string;
    public readonly metadata?: Record<string, any>;
    public readonly timestamp: Date;

    constructor(
        message: string,
        type: ErrorType = ErrorType.UNKNOWN,
        code?: string,
        metadata?: Record<string, any>
    ) {
        super(message);
        this.name = 'MinebotError';
        this.type = type;
        this.code = code;
        this.metadata = metadata;
        this.timestamp = new Date();

        // プロトタイプチェーンを維持
        Object.setPrototypeOf(this, MinebotError.prototype);
    }

    /**
     * エラーをJSON形式で出力
     */
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            type: this.type,
            code: this.code,
            metadata: this.metadata,
            timestamp: this.timestamp.toISOString(),
            stack: this.stack,
        };
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


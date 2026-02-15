/**
 * Shannon unified error hierarchy.
 *
 * All custom errors across the application should extend ShannonError.
 * This provides consistent error structure, serialization, and metadata.
 */

export enum ErrorType {
  // LLM
  LLM = 'LLM_ERROR',

  // Skill
  SKILL_LOAD = 'SKILL_LOAD_ERROR',
  SKILL_EXECUTION = 'SKILL_EXECUTION_ERROR',

  // Infrastructure
  HTTP_SERVER = 'HTTP_SERVER_ERROR',
  CONFIG = 'CONFIG_ERROR',

  // Services
  DISCORD = 'DISCORD_ERROR',
  TWITTER = 'TWITTER_ERROR',
  YOUTUBE = 'YOUTUBE_ERROR',
  NOTION = 'NOTION_ERROR',
  MINECRAFT = 'MINECRAFT_ERROR',

  // General
  TOOL = 'TOOL_ERROR',
  TIMEOUT = 'TIMEOUT_ERROR',
  UNKNOWN = 'UNKNOWN_ERROR',
}

/**
 * Base error class for the entire Shannon application.
 */
export class ShannonError extends Error {
  public readonly type: ErrorType;
  public readonly code?: string;
  public readonly metadata?: Record<string, unknown>;
  public readonly timestamp: Date;

  constructor(
    message: string,
    type: ErrorType = ErrorType.UNKNOWN,
    code?: string,
    metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ShannonError';
    this.type = type;
    this.code = code;
    this.metadata = metadata;
    this.timestamp = new Date();
    Object.setPrototypeOf(this, new.target.prototype);
  }

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

/** LLM service error */
export class LLMError extends ShannonError {
  constructor(phase: string, originalError?: Error) {
    super(
      `LLM error in ${phase}: ${originalError?.message ?? 'unknown'}`,
      ErrorType.LLM,
      'LLM_ERROR',
      { phase, originalError: originalError?.message }
    );
    this.name = 'LLMError';
  }
}

/** Tool execution error */
export class ToolError extends ShannonError {
  constructor(toolName: string, originalError?: Error) {
    super(
      `Tool error: ${toolName} - ${originalError?.message ?? 'unknown'}`,
      ErrorType.TOOL,
      'TOOL_ERROR',
      { toolName, originalError: originalError?.message }
    );
    this.name = 'ToolError';
  }
}

/** Service timeout error */
export class TimeoutError extends ShannonError {
  constructor(operation: string, timeoutMs: number) {
    super(
      `Timeout after ${timeoutMs}ms: ${operation}`,
      ErrorType.TIMEOUT,
      'TIMEOUT',
      { operation, timeoutMs }
    );
    this.name = 'TimeoutError';
  }
}

/**
 * Safely extracts an error message from an unknown caught value.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

/**
 * Wraps an unknown error into a ShannonError if it isn't one already.
 */
export function toShannonError(
  error: unknown,
  type: ErrorType = ErrorType.UNKNOWN
): ShannonError {
  if (error instanceof ShannonError) return error;
  if (error instanceof Error) {
    return new ShannonError(error.message, type, undefined, {
      originalName: error.name,
      originalStack: error.stack,
    });
  }
  return new ShannonError(String(error), type);
}

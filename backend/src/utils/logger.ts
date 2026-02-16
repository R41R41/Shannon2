/**
 * Shared structured logger utility.
 *
 * Each log line includes:
 *   - Timestamp (JST, ms precision)
 *   - Log level (INFO / ERROR / WARN / SUCCESS / DEBUG)
 *   - LOG_ID  (session-scoped sequential ID for tracing)
 *   - Message body
 *
 * Format (terminal):
 *   2026-02-16 19:30:45.123 [INFO   ] #0001 Server started   (with ANSI colors)
 *
 * Format (file):
 *   2026-02-16 19:30:45.123 [INFO   ] #0001 Server started   (plain text)
 *
 * File logging:
 *   import { logger, initFileLogging } from '../../utils/logger.js';
 *   initFileLogging('/path/to/logs');  // call once at startup
 *
 * Usage:
 *   logger.info('Server started', 'blue');
 *   logger.error('Connection failed');
 *   logger.success('Task completed');
 */
import { existsSync, mkdirSync, createWriteStream, type WriteStream } from 'fs';
import { join } from 'path';
import type { Color } from '@shannon/common';

// ---------------------------------------------------------------------------
// ANSI colors
// ---------------------------------------------------------------------------
const ANSI: Record<Color, string> = {
  white: '\x1b[37m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function colorize(text: string, color: Color): string {
  return `${ANSI[color]}${text}${RESET}`;
}

/** Strip all ANSI escape codes from a string */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

// ---------------------------------------------------------------------------
// File logging (optional, call initFileLogging() to enable)
// ---------------------------------------------------------------------------
let fileStream: WriteStream | null = null;
let currentLogDate = '';

/** Directory for log files (set by initFileLogging) */
let logDir = '';

function getLogFileName(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const mo = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `prod-${y}${mo}${d}.log`;
}

function ensureFileStream(): void {
  if (!logDir) return;

  const fileName = getLogFileName();
  const dateKey = fileName;

  // Rotate on date change
  if (dateKey !== currentLogDate) {
    if (fileStream) {
      fileStream.end();
    }
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    fileStream = createWriteStream(join(logDir, fileName), { flags: 'a' });
    currentLogDate = dateKey;
  }
}

function writeToFile(line: string): void {
  if (!logDir) return;
  ensureFileStream();
  fileStream?.write(stripAnsi(line) + '\n');
}

/**
 * Enable file logging. Call once at startup.
 * Logs are written as plain text (no ANSI codes) to `<dir>/prod-YYYYMMDD.log`.
 * Files rotate automatically at midnight (JST).
 */
export function initFileLogging(dir: string): void {
  logDir = dir;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  ensureFileStream();
  console.log(`📁 File logging enabled: ${dir}`);
}

// ---------------------------------------------------------------------------
// Log ID (session-scoped sequential counter)
// ---------------------------------------------------------------------------
let logCounter = 0;

function nextLogId(): string {
  logCounter += 1;
  return String(logCounter).padStart(4, '0');
}

// ---------------------------------------------------------------------------
// Timestamp (JST)
// ---------------------------------------------------------------------------
function timestamp(): string {
  const now = new Date();
  // JST = UTC+9
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const mo = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  const h = String(jst.getUTCHours()).padStart(2, '0');
  const mi = String(jst.getUTCMinutes()).padStart(2, '0');
  const s = String(jst.getUTCSeconds()).padStart(2, '0');
  const ms = String(jst.getUTCMilliseconds()).padStart(3, '0');
  return `${y}-${mo}-${d} ${h}:${mi}:${s}.${ms}`;
}

// ---------------------------------------------------------------------------
// Level tags (fixed width 7 chars including brackets)
// ---------------------------------------------------------------------------
type Level = 'INFO' | 'ERROR' | 'WARN' | 'SUCCESS' | 'DEBUG';

const LEVEL_COLORS: Record<Level, Color> = {
  INFO: 'white',
  ERROR: 'red',
  WARN: 'yellow',
  SUCCESS: 'green',
  DEBUG: 'cyan',
};

function formatPrefix(level: Level): string {
  const ts = `${DIM}${timestamp()}${RESET}`;
  const tag = colorize(`[${level.padEnd(7)}]`, LEVEL_COLORS[level]);
  const id = `${DIM}#${nextLogId()}${RESET}`;
  return `${ts} ${tag} ${id}`;
}

// ---------------------------------------------------------------------------
// Public API (same signatures as before)
// ---------------------------------------------------------------------------
export const logger = {
  /** General log with optional color */
  info(message: string, color?: Color): void {
    const body = color ? colorize(message, color) : message;
    const line = `${formatPrefix('INFO')} ${body}`;
    console.log(line);
    writeToFile(line);
  },

  /** Error log (always red) */
  error(message: string, error?: unknown): void {
    const line = `${formatPrefix('ERROR')} ${colorize(message, 'red')}`;
    console.error(line);
    writeToFile(line);
    if (error) {
      console.error(error);
      writeToFile(String(error instanceof Error ? error.stack || error.message : error));
    }
  },

  /** Warning log (always yellow) */
  warn(message: string): void {
    const line = `${formatPrefix('WARN')} ${colorize(message, 'yellow')}`;
    console.log(line);
    writeToFile(line);
  },

  /** Success log (always green) */
  success(message: string): void {
    const line = `${formatPrefix('SUCCESS')} ${colorize(message, 'green')}`;
    console.log(line);
    writeToFile(line);
  },

  /** Debug log (always cyan) */
  debug(message: string): void {
    const line = `${formatPrefix('DEBUG')} ${colorize(message, 'cyan')}`;
    console.log(line);
    writeToFile(line);
  },

  /** Colorize a string without logging (for embedding in other logs) */
  colorize,
};

// ---------------------------------------------------------------------------
// Named logger type (returned by createLogger)
// ---------------------------------------------------------------------------
export type NamedLogger = Omit<typeof logger, 'colorize'>;

// ---------------------------------------------------------------------------
// Factory: create a logger with a fixed prefix
// ---------------------------------------------------------------------------
/**
 * Creates a logger that prepends `[prefix]` to every message.
 *
 * @example
 *   const log = createLogger('Minebot:TaskGraph');
 *   log.info('タスク開始');
 *   // → 2026-02-16 19:30:45.123 [INFO   ] #0312 [Minebot:TaskGraph] タスク開始
 */
export function createLogger(prefix: string): NamedLogger {
  const tag = `[${prefix}]`;
  return {
    info: (message: string, color?: Color) => logger.info(`${tag} ${message}`, color),
    error: (message: string, error?: unknown) => logger.error(`${tag} ${message}`, error),
    warn: (message: string) => logger.warn(`${tag} ${message}`),
    success: (message: string) => logger.success(`${tag} ${message}`),
    debug: (message: string) => logger.debug(`${tag} ${message}`),
  };
}

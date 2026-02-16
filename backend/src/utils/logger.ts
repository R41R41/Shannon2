/**
 * Shared structured logger utility.
 *
 * Each log line includes:
 *   - Timestamp (JST, ms precision)
 *   - Log level (INFO / ERROR / WARN / SUCCESS / DEBUG)
 *   - LOG_ID  (session-scoped sequential ID for tracing)
 *   - Message body
 *
 * Format:
 *   2026-02-16 19:30:45.123 [INFO ] #0001 Server started
 *
 * Usage:
 *   import { logger } from '../../utils/logger.js';
 *   logger.info('Server started', 'blue');
 *   logger.error('Connection failed');
 *   logger.success('Task completed');
 */
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
    console.log(`${formatPrefix('INFO')} ${body}`);
  },

  /** Error log (always red) */
  error(message: string, error?: unknown): void {
    console.error(`${formatPrefix('ERROR')} ${colorize(message, 'red')}`);
    if (error) console.error(error);
  },

  /** Warning log (always yellow) */
  warn(message: string): void {
    console.log(`${formatPrefix('WARN')} ${colorize(message, 'yellow')}`);
  },

  /** Success log (always green) */
  success(message: string): void {
    console.log(`${formatPrefix('SUCCESS')} ${colorize(message, 'green')}`);
  },

  /** Debug log (always cyan) */
  debug(message: string): void {
    console.log(`${formatPrefix('DEBUG')} ${colorize(message, 'cyan')}`);
  },

  /** Colorize a string without logging (for embedding in other logs) */
  colorize,
};

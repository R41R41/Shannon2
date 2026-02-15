/**
 * Shared colored logger utility.
 *
 * Replaces inline ANSI escape codes scattered across the codebase.
 * Usage:
 *   import { logger } from '../../utils/logger.js';
 *   logger.info('Server started', 'blue');
 *   logger.error('Connection failed');
 *   logger.success('Task completed');
 */
import type { Color } from '@shannon/common';

const ANSI: Record<Color, string> = {
  white: '\x1b[37m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};
const RESET = '\x1b[0m';

function colorize(text: string, color: Color): string {
  return `${ANSI[color]}${text}${RESET}`;
}

export const logger = {
  /** General log with optional color */
  info(message: string, color?: Color): void {
    console.log(color ? colorize(message, color) : message);
  },

  /** Error log (always red) */
  error(message: string, error?: unknown): void {
    console.error(colorize(message, 'red'));
    if (error) console.error(error);
  },

  /** Warning log (always yellow) */
  warn(message: string): void {
    console.log(colorize(message, 'yellow'));
  },

  /** Success log (always green) */
  success(message: string): void {
    console.log(colorize(message, 'green'));
  },

  /** Debug log (always cyan) */
  debug(message: string): void {
    console.log(colorize(message, 'cyan'));
  },

  /** Colorize a string without logging (for embedding in other logs) */
  colorize,
};

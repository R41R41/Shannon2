/**
 * Centralized LLM model configuration.
 *
 * All model names are defined here. Changing a model across
 * the entire application only requires editing this file.
 *
 * Usage:
 *   import { models } from '../../config/models.js';
 *   const llm = new ChatOpenAI({ modelName: models.functionCalling });
 */

export const models = {
  /** Main function-calling agent model (Discord/WebUI and Minebot) */
  functionCalling: 'gpt-4.1-mini',

  /** Emotion analysis model (lightweight, fast) */
  emotion: 'gpt-5-mini',

  /** Minebot planning model (reasoning-focused) */
  planning: 'o4-mini',

  /** Content generation: reply to comments, fortune, etc. */
  contentGeneration: 'gpt-5-mini',

  /** Scheduled posting agents (weather, news, about-today) */
  scheduledPost: 'gpt-5-mini',

  /** Vision / image description */
  vision: 'gpt-5-mini',

  /** Image generation */
  imageGeneration: 'gpt-image-1',

  /** Blueprint creation (minebot) */
  blueprint: 'gpt-4.1-mini',

  /** Emergency responder (minebot) */
  emergency: 'gpt-4.1-mini',

  /** Realtime API (voice) */
  realtime: 'gpt-realtime-mini',

  /** Audio transcription */
  whisper: 'whisper-1',

  // --- Minebot config (used by MinebotConfig) ---
  minebot: {
    centralAgent: 'gpt-4.1-mini',
    execution: 'gpt-4.1-mini',
    functionCalling: 'gpt-4.1-mini',
  },
} as const;

export type ModelName = (typeof models)[keyof Omit<typeof models, 'minebot'>];

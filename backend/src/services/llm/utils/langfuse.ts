/**
 * Langfuse integration for LLM observability.
 *
 * Provides:
 *  - createTracedModel()   — drop-in replacement for `new ChatOpenAI()`
 *  - getTracedOpenAI()     — wrapped OpenAI client for direct API calls
 *  - langfuseEnabled       — whether Langfuse credentials are configured
 *  - shutdownLangfuse()    — flush pending events (call on graceful shutdown)
 */
import { ChatOpenAI, type ChatOpenAICallOptions } from '@langchain/openai';
import OpenAI from 'openai';
import { config } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';

type ChatOpenAIConstructorArgs = ConstructorParameters<typeof ChatOpenAI>[0];

let _langfuse: any = null;
let _callbackHandler: any = null;
let _initAttempted = false;

export const langfuseEnabled =
  !!config.langfuse.secretKey && !!config.langfuse.publicKey;

async function initLangfuse() {
  if (_initAttempted) return;
  _initAttempted = true;

  if (!langfuseEnabled) {
    logger.debug('[Langfuse] No credentials configured — tracing disabled');
    return;
  }

  try {
    const { Langfuse } = await import('langfuse');
    _langfuse = new Langfuse({
      secretKey: config.langfuse.secretKey,
      publicKey: config.langfuse.publicKey,
      baseUrl: config.langfuse.baseUrl,
    });
    logger.info('[Langfuse] Initialized — tracing enabled');

    const { CallbackHandler } = await import('langfuse-langchain');
    _callbackHandler = new CallbackHandler({
      secretKey: config.langfuse.secretKey,
      publicKey: config.langfuse.publicKey,
      baseUrl: config.langfuse.baseUrl,
    });
  } catch (err) {
    logger.warn(`[Langfuse] Failed to initialize: ${err}`);
  }
}

const _initPromise = initLangfuse();

/**
 * Drop-in replacement for `new ChatOpenAI(...)`.
 * Automatically attaches the Langfuse callback handler when credentials are set.
 */
export function createTracedModel(
  opts?: ChatOpenAIConstructorArgs,
): ChatOpenAI {
  if (!_callbackHandler) {
    return new ChatOpenAI(opts);
  }
  const existing = (opts as any)?.callbacks ?? [];
  return new ChatOpenAI({
    ...opts,
    callbacks: [...existing, _callbackHandler],
  } as any);
}

/**
 * Wraps an OpenAI client instance with Langfuse observation (for direct API calls).
 */
export function getTracedOpenAI(client: OpenAI): OpenAI {
  if (!_langfuse) return client;
  try {
    return _langfuse.observeOpenAI(client) as OpenAI;
  } catch {
    return client;
  }
}

/**
 * Flush pending Langfuse events. Call on graceful shutdown.
 */
export async function shutdownLangfuse(): Promise<void> {
  await _initPromise;
  if (_callbackHandler) {
    try { await _callbackHandler.flushAsync(); } catch { /* noop */ }
  }
  if (_langfuse) {
    try { await _langfuse.shutdownAsync(); } catch { /* noop */ }
  }
}

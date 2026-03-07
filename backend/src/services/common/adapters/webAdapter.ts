/**
 * Web Channel Adapter
 *
 * Converts Web UI messages (text, realtime, commands)
 * into RequestEnvelopes and dispatches ShannonActionPlans
 * back as WebSocket messages.
 */

import {
  RequestEnvelope,
  ShannonActionPlan,
  ChannelAdapter,
} from '@shannon/common';
import { createEnvelope } from './envelopeFactory.js';

/**
 * Shape of a web text input event.
 * Mirrors OpenAITextInput in web/openaiAgent.ts.
 */
export interface WebNativeEvent {
  type: 'text' | 'realtime_text' | 'realtime_audio' | 'command';
  text?: string;
  realtimeText?: string;
  senderName?: string;
  recentChatLog?: string;
  sessionId?: string;
}

/** Callback for sending responses back to web UI. */
export type WebDispatchFn = (plan: ShannonActionPlan) => Promise<void>;

export class WebAdapter implements ChannelAdapter<WebNativeEvent> {
  readonly channel = 'web' as const;

  constructor(private dispatchFn?: WebDispatchFn) {}

  setDispatch(fn: WebDispatchFn): void {
    this.dispatchFn = fn;
  }

  toEnvelope(event: WebNativeEvent): RequestEnvelope {
    const text = event.text ?? event.realtimeText ?? '';
    const tags: string[] = [event.type];
    const sessionId = event.sessionId ?? 'web-default';

    return createEnvelope({
      channel: 'web',
      sourceUserId: event.senderName ?? 'web-user',
      sourceDisplayName: event.senderName,
      conversationId: `web:${sessionId}`,
      threadId: `web:${sessionId}`,
      text,
      tags,
      metadata: {
        recentChatLog: event.recentChatLog,
        inputType: event.type,
        legacyMemoryZone: 'web',
      },
    });
  }

  async dispatch(plan: ShannonActionPlan): Promise<void> {
    if (!this.dispatchFn) {
      throw new Error('WebAdapter: dispatchFn not set');
    }
    await this.dispatchFn(plan);
  }
}

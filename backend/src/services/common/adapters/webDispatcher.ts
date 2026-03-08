/**
 * Web Action Dispatcher
 *
 * Sends ShannonActionPlans back to the Web UI.
 */

import type {
  RequestEnvelope,
  ShannonActionPlan,
  ActionDispatcher,
} from '@shannon/common';
import { getEventBus } from '../../../events/eventBus.js';

export const webDispatcher: ActionDispatcher = {
  channel: 'web',

  async dispatch(envelope: RequestEnvelope, plan: ShannonActionPlan): Promise<void> {
    const eventBus = getEventBus();

    if (plan.message) {
      eventBus.publish({
        type: 'web:send_message',
        memoryZone: 'web',
        data: {
          text: plan.message,
          sessionId: envelope.metadata?.sessionId ?? envelope.conversationId,
        },
      });
    }
  },
};

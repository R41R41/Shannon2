import { BaseMessage } from '@langchain/core/messages';
import { TaskTreeState } from '@shannon/common';

export interface TaskStateInput {
  taskId?: string | null;
  environmentState?: string | null;
  selfState?: string | null;
  humanFeedback?: string | null;
  taskTree?: TaskTreeState | null;
  messages?: BaseMessage[];
  responseMessage?: string | null;
  userMessage?: string | null;
  humanFeedbackPending?: boolean;
  forceStop?: boolean;
  retryCount?: number;
}

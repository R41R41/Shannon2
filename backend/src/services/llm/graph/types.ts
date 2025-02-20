import { MemoryZone, EmotionType, TaskTreeState } from '@shannon/common';
import { BaseMessage } from '@langchain/core/messages';

export interface TaskStateInput {
  emotion?: EmotionType | null;
  memoryZone?: MemoryZone;
  systemPrompt?: string;
  environmentState?: string | null;
  selfState?: string | null;
  humanFeedback?: string | null;
  selfFeedback?: string | null;
  taskTree?: TaskTreeState | null;
  messages?: BaseMessage[];
  responseMessage?: string | null;
  userMessage?: string | null;
}

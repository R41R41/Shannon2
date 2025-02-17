import { MemoryZone, EmotionType } from '@shannon/common';
import { BaseMessage } from '@langchain/core/messages';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'error';
export type NextAction = 'use_tool' | 'make_and_send_message' | 'END';

export interface TaskTreeState {
  goal: string;
  plan: string;
  status: TaskStatus;
  error?: string | null;
  subTasks?: TaskTreeState[] | null;
}

export interface TaskStateInput {
  emotion?: EmotionType | null;
  memoryZone?: MemoryZone;
  systemPrompt?: string;
  environmentState?: string | null;
  selfState?: string | null;
  humanFeedback?: string | null;
  selfFeedback?: string | null;
  taskTree?: TaskTreeState | null;
  nextAction?: NextAction | null;
  messages?: BaseMessage[];
  responseMessage?: string | null;
  userMessage?: string | null;
}

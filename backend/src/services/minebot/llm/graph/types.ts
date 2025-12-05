import { BaseMessage } from '@langchain/core/messages';
import { TaskTreeState } from '@shannon/common';

export interface TaskStateInput {
  taskId?: string | null;
  environmentState?: string | null;
  selfState?: string | null;
  botStatus?: any; // 詳細なボット状態（selfState の後継）
  humanFeedback?: string | null;
  taskTree?: TaskTreeState | null;
  messages?: BaseMessage[];
  userMessage?: string | null;
  humanFeedbackPending?: boolean;
  forceStop?: boolean;
  retryCount?: number;
  isEmergency?: boolean; // 緊急事態フラグ
  emergencyType?: string; // 緊急事態の種類
  resuming?: boolean; // タスク復帰フラグ
}

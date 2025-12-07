import { BaseMessage } from '@langchain/core/messages';
import {
  ActionItem,
  EmotionType,
  HierarchicalSubTask,
  MemoryZone,
  TaskContext,
  TaskStatus,
  TaskTreeState,
} from '@shannon/common';

/**
 * タスクグラフの入力状態
 */
export interface TaskStateInput {
  taskId?: string | null;
  emotion?: EmotionType | null;

  // === コンテキスト情報 ===
  /** @deprecated memoryZoneの代わりにcontextを使用してください */
  memoryZone?: MemoryZone;
  context?: TaskContext;
  channelId?: string | null;

  // === 環境・状態情報 ===
  systemPrompt?: string;
  environmentState?: string | null;
  selfState?: string | null;

  // === フィードバック ===
  humanFeedback?: string | null;
  selfFeedback?: string | null;

  // === タスク情報 ===
  taskTree?: TaskTreeState | null;
  messages?: BaseMessage[];
  responseMessage?: string | null;
  userMessage?: string | null;

  // === 制御フラグ ===
  retryCount?: number;
  isEmergency?: boolean;

  // === 実行結果 ===
  executionResults?: ExecutionResult[] | null;
}

/**
 * 実行結果の型定義
 */
export interface ExecutionResult {
  toolName: string;
  args: Record<string, any>;
  success: boolean;
  message: string;
  duration: number;
  error?: string;
}

/**
 * タスクキューのエントリ
 */
export interface TaskQueueEntry {
  id: string;
  taskTree: TaskTreeState | null;
  state: TaskStateInput;
  createdAt: number;
  status: 'pending' | 'executing' | 'paused';
}

/**
 * タスクリストの状態（UI表示用）
 */
export interface TaskListState {
  tasks: Array<{
    id: string;
    goal: string;
    status: 'pending' | 'executing' | 'paused';
    createdAt: number;
  }>;
  emergencyTask: {
    id: string;
    goal: string;
    createdAt: number;
  } | null;
  currentTaskId: string | null;
}

/**
 * グラフ設定
 */
export const GRAPH_CONFIG = {
  /** 最大再試行回数 */
  MAX_RETRY_COUNT: 10,
  /** 最大キューサイズ */
  MAX_QUEUE_SIZE: 3,
  /** LangGraphの再帰制限 */
  RECURSION_LIMIT: 64,
  /** 直近のメッセージ数（プロンプトに含める） */
  MAX_RECENT_MESSAGES: 10,
  /** 同じアクションの繰り返し検出閾値 */
  REPEAT_ACTION_THRESHOLD: 5,
  /** チャットアクションの繰り返し検出閾値 */
  REPEAT_CHAT_THRESHOLD: 2,
} as const;

// 既存の型をre-export
export type {
  ActionItem, EmotionType, HierarchicalSubTask, MemoryZone, TaskContext, TaskStatus, TaskTreeState
};

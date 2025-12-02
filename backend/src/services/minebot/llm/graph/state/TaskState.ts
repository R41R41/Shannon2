import { BaseMessage } from '@langchain/core/messages';
import { Annotation } from '@langchain/langgraph';
import { TaskTreeState } from '@shannon/common';

/**
 * Task Status Type
 */
export type TaskStatus =
    | 'pending'
    | 'understanding'
    | 'planning'
    | 'executing'
    | 'reflecting'
    | 'completed'
    | 'error';

/**
 * Understanding Result
 */
export interface UnderstandingResult {
    intent: string;
    extractedInfo: Record<string, unknown>;
    timestamp: Date;
}

/**
 * Execution Result
 */
export interface ExecutionResult {
    skillName: string;
    success: boolean;
    message: string;
    duration?: number;
    error?: string;
    timestamp: Date;
}

/**
 * Reflection Result
 */
export interface ReflectionResult {
    summary: string;
    shouldContinue: boolean;
    hasErrors: boolean;
    nextAction: 'replan' | 'execute' | 'done';
    timestamp: Date;
}

/**
 * Task State Schema
 * LangGraphで使用する状態定義
 */
export const TaskStateAnnotation = Annotation.Root({
    taskId: Annotation<string>({
        reducer: (_, next) => next,
        default: () => '',
    }),
    goal: Annotation<string>({
        reducer: (_, next) => next,
        default: () => '',
    }),
    status: Annotation<TaskStatus>({
        reducer: (_, next) => next,
        default: () => 'pending' as TaskStatus,
    }),
    environmentState: Annotation<string | null>({
        reducer: (_, next) => next,
        default: () => null,
    }),
    selfState: Annotation<string | null>({
        reducer: (_, next) => next,
        default: () => null,
    }),
    humanFeedback: Annotation<string | null>({
        reducer: (_, next) => next,
        default: () => null,
    }),
    messages: Annotation<BaseMessage[]>({
        reducer: (prev, next) => {
            if (next === null) {
                return prev;
            } else {
                return prev?.concat(next) ?? next;
            }
        },
        default: () => [],
    }),
    userMessage: Annotation<string | null>({
        reducer: (_, next) => next,
        default: () => null,
    }),
    taskTree: Annotation<TaskTreeState | null>({
        reducer: (_, next) => next,
        default: () => null,
    }),
    humanFeedbackPending: Annotation<boolean>({
        reducer: (_, next) => next,
        default: () => false,
    }),
    retryCount: Annotation<number>({
        reducer: (prev, next) => (next === undefined ? prev : next),
        default: () => 0,
    }),
    forceStop: Annotation<boolean>({
        reducer: (_, next) => next,
        default: () => false,
    }),
    // 新規追加：各フェーズの結果
    understanding: Annotation<UnderstandingResult | null>({
        reducer: (_, next) => next,
        default: () => null,
    }),
    plan: Annotation<TaskTreeState | null>({
        reducer: (_, next) => next,
        default: () => null,
    }),
    executionResults: Annotation<ExecutionResult[]>({
        reducer: (_, next) => next,
        default: () => [],
    }),
    reflection: Annotation<ReflectionResult | null>({
        reducer: (_, next) => next,
        default: () => null,
    }),
    error: Annotation<Error | null>({
        reducer: (_, next) => next,
        default: () => null,
    }),
});

/**
 * Task State Interface
 */
export interface TaskState {
    taskId: string;
    goal: string;
    status: TaskStatus;
    environmentState: string | null;
    selfState: string | null;
    humanFeedback: string | null;
    messages: BaseMessage[];
    userMessage: string | null;
    taskTree: TaskTreeState | null;
    humanFeedbackPending: boolean;
    retryCount: number;
    forceStop: boolean;
    understanding?: UnderstandingResult | null;
    plan?: TaskTreeState | null;
    executionResults?: ExecutionResult[];
    reflection?: ReflectionResult | null;
    error?: Error | null;
}


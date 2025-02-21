export interface TaskInput {
  waitSeconds?: number | null;
  date?: Date | null;
}

export type TaskStatus = "pending" | "in_progress" | "completed" | "error";

export interface TaskTreeState {
  goal: string;
  strategy: string;
  status: TaskStatus;
  error?: string | null;
  subTasks?:
    | {
        subTaskGoal: string;
        subTaskStrategy: string;
        subTaskStatus: TaskStatus;
      }[]
    | null;
}

export interface EmotionType {
  emotion: string;
  parameters: {
    joy: number;
    trust: number;
    fear: number;
    surprise: number;
    sadness: number;
    disgust: number;
    anger: number;
    anticipation: number;
  };
}

export type TaskEventType = "task:stop" | "task:start";

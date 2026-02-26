/**
 * タスクライフサイクルのステートマシン。
 * 各タスクの状態遷移を厳密に管理し、不正な遷移を防止する。
 */
import { createLogger } from '../../../utils/logger.js';
import { EventBus } from '../../eventBus/eventBus.js';

const log = createLogger('Minebot:TaskSM');

export type TaskState =
  | 'pending'
  | 'planning'
  | 'executing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'retrying';

const VALID_TRANSITIONS: Record<TaskState, TaskState[]> = {
  pending: ['planning', 'failed'],
  planning: ['executing', 'failed', 'timeout'],
  executing: ['completed', 'failed', 'paused', 'timeout', 'retrying'],
  paused: ['planning', 'executing', 'failed'],
  retrying: ['planning', 'failed', 'timeout'],
  completed: [],
  failed: [],
  timeout: [],
};

export interface TaskInfo {
  id: string;
  goal: string;
  state: TaskState;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  retryCount: number;
  maxRetries: number;
  error: string | null;
  history: Array<{ from: TaskState; to: TaskState; timestamp: number; reason?: string }>;
}

type StateChangeListener = (task: TaskInfo, from: TaskState, to: TaskState) => void;

export class TaskStateMachine {
  private tasks = new Map<string, TaskInfo>();
  private listeners: StateChangeListener[] = [];
  private nextId = 1;

  constructor(private eventBus?: EventBus) {}

  createTask(goal: string, maxRetries = 3): TaskInfo {
    const id = `task-${this.nextId++}-${Date.now()}`;
    const task: TaskInfo = {
      id,
      goal,
      state: 'pending',
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      retryCount: 0,
      maxRetries,
      error: null,
      history: [],
    };
    this.tasks.set(id, task);
    log.info(`タスク作成: [${id}] "${goal}"`, 'cyan');
    return task;
  }

  transition(taskId: string, to: TaskState, reason?: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      log.warn(`不明なタスクID: ${taskId}`);
      return false;
    }

    const from = task.state;
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed.includes(to)) {
      log.warn(`無効な遷移: ${from} → ${to} (タスク: ${taskId})`);
      return false;
    }

    task.state = to;
    task.history.push({ from, to, timestamp: Date.now(), reason });

    if (to === 'planning' || to === 'executing') {
      task.startedAt = task.startedAt || Date.now();
    }
    if (to === 'completed' || to === 'failed' || to === 'timeout') {
      task.completedAt = Date.now();
    }
    if (to === 'failed' && reason) {
      task.error = reason;
    }
    if (to === 'retrying') {
      task.retryCount++;
    }

    const emoji = { pending: '⏳', planning: '📝', executing: '⚡', paused: '⏸️', completed: '✅', failed: '❌', timeout: '⏱️', retrying: '🔄' }[to];
    log.info(`${emoji} [${taskId}] ${from} → ${to}${reason ? ` (${reason})` : ''}`);

    for (const listener of this.listeners) {
      try { listener(task, from, to); } catch {}
    }

    this.eventBus?.publish({
      type: 'web:planning' as any,
      memoryZone: 'web',
      data: {
        goal: task.goal,
        status: to,
        subTasks: [],
      },
    });

    return true;
  }

  canRetry(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    return task.retryCount < task.maxRetries && (task.state === 'failed' || task.state === 'executing');
  }

  getTask(taskId: string): TaskInfo | undefined {
    return this.tasks.get(taskId);
  }

  getActiveTasks(): TaskInfo[] {
    return Array.from(this.tasks.values()).filter(
      (t) => !['completed', 'failed', 'timeout'].includes(t.state),
    );
  }

  getAllTasks(): TaskInfo[] {
    return Array.from(this.tasks.values());
  }

  onStateChange(listener: StateChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  getStats(): {
    total: number;
    active: number;
    completed: number;
    failed: number;
    avgDurationMs: number;
  } {
    const all = this.getAllTasks();
    const finished = all.filter((t) => t.completedAt);
    const durations = finished
      .filter((t) => t.startedAt)
      .map((t) => t.completedAt! - t.startedAt!);

    return {
      total: all.length,
      active: this.getActiveTasks().length,
      completed: all.filter((t) => t.state === 'completed').length,
      failed: all.filter((t) => t.state === 'failed' || t.state === 'timeout').length,
      avgDurationMs: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
    };
  }

  cleanup(maxAge = 3600000): void {
    const now = Date.now();
    for (const [id, task] of this.tasks) {
      if (task.completedAt && now - task.completedAt > maxAge) {
        this.tasks.delete(id);
      }
    }
  }
}

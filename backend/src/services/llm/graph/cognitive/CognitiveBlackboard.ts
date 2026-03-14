import { EventEmitter } from 'node:events';
import { BaseMessage } from '@langchain/core/messages';
import { EmotionType } from '@shannon/common';
import { ExecutionResult } from '../types.js';

/**
 * CognitiveBlackboard — 3並列プロセス間の共有状態。
 *
 * 脳の「ワーキングメモリ」に相当し、感情・メタ認知・タスク実行の
 * 各プロセスがイベント駆動で読み書きする。
 *
 * Events:
 *   'emotion:updated'  — EmotionLoop が感情を更新した
 *   'meta:updated'     — MetaCognitionLoop がメタ状態を更新した
 *   'task:updated'     — TaskExecutionLoop がタスク状態を更新した
 *   'loop:detected'    — LoopDetector がループを検出した
 *   'emotion:shifted'  — 感情が大きく変化した（急変検出）
 *   'completed'        — タスクが完了した（全プロセスに停止シグナル）
 */

export type MetaAssessment = 'on_track' | 'struggling' | 'stuck' | 'wrong_approach';

export interface MetaState {
    assessment: MetaAssessment;
    suggestion: string | null;
    modelAction: 'escalate' | 'deescalate' | 'hold';
    shouldStop: boolean;
    timestamp: number;
}

export interface TaskState {
    iteration: number;
    recentToolCalls: ExecutionResult[];
    currentThinking: string | null;
    totalSuccesses: number;
    totalFailures: number;
    timestamp: number;
}

export interface InventoryEntry {
    name: string;
    count: number;
}

export interface PlanSubtask {
    id: string;                // "st_1", "st_2"
    goal: string;              // "cobblestoneを8個採掘する"
    status: 'pending' | 'in_progress' | 'completed' | 'error' | 'skipped';
    result?: string;
    failureReason?: string;
    iterationsSpent: number;   // このサブタスクに費やしたイテレーション数
}

export interface PlanState {
    goal: string;
    strategy: string;
    subtasks: PlanSubtask[];
    currentSubtaskId: string | null;
    lastUpdatedBy: 'craft_preflight' | 'meta_cognition' | 'fca';
    createdAt: number;
    updatedAt: number;
}

export interface BlackboardSnapshot {
    goal: string;
    emotionState: EmotionType | null;
    metaState: MetaState | null;
    taskState: TaskState;
    inventory: InventoryEntry[] | null;
    plan: PlanState | null;
    isComplete: boolean;
    elapsedMs: number;
}

const EMOTION_SHIFT_THRESHOLD = 30;

export class CognitiveBlackboard extends EventEmitter {
    // Emotion (Amygdala)
    private _emotionState: EmotionType | null = null;
    private _previousEmotion: EmotionType | null = null;

    // Meta-cognition (DLPFC)
    private _metaState: MetaState | null = null;

    // Task Execution (Motor Cortex)
    private _taskState: TaskState = {
        iteration: 0,
        recentToolCalls: [],
        currentThinking: null,
        totalSuccesses: 0,
        totalFailures: 0,
        timestamp: Date.now(),
    };

    // Inventory (Minecraft)
    private _inventory: InventoryEntry[] | null = null;

    // Plan (Prefrontal Cortex — 計画管理)
    private _planState: PlanState | null = null;

    // Coordination
    readonly goal: string;
    private _isComplete = false;
    private _startTime: number;
    private _abortController: AbortController;

    // Messages (shared reference for all processes)
    private _messages: BaseMessage[];

    constructor(goal: string, initialEmotion: EmotionType | null, messages: BaseMessage[]) {
        super();
        this.setMaxListeners(20);
        this.goal = goal;
        this._emotionState = initialEmotion;
        this._messages = messages;
        this._startTime = Date.now();
        this._abortController = new AbortController();
    }

    // ── Getters ──

    get emotionState(): EmotionType | null { return this._emotionState; }
    get metaState(): MetaState | null { return this._metaState; }
    get taskState(): TaskState { return this._taskState; }
    get inventory(): InventoryEntry[] | null { return this._inventory; }
    get plan(): PlanState | null { return this._planState; }
    get isComplete(): boolean { return this._isComplete; }
    get signal(): AbortSignal { return this._abortController.signal; }
    get messages(): BaseMessage[] { return this._messages; }
    get elapsedMs(): number { return Date.now() - this._startTime; }

    snapshot(): BlackboardSnapshot {
        return {
            goal: this.goal,
            emotionState: this._emotionState,
            metaState: this._metaState,
            taskState: { ...this._taskState },
            inventory: this._inventory,
            plan: this._planState ? { ...this._planState, subtasks: this._planState.subtasks.map(s => ({ ...s })) } : null,
            isComplete: this._isComplete,
            elapsedMs: this.elapsedMs,
        };
    }

    // ── Update methods (each emits events) ──

    updateEmotion(emotion: EmotionType): void {
        this._previousEmotion = this._emotionState;
        this._emotionState = emotion;
        this.emit('emotion:updated', emotion);

        if (this._previousEmotion && this.detectEmotionShift(this._previousEmotion, emotion)) {
            this.emit('emotion:shifted', emotion, this._previousEmotion);
        }
    }

    updateMeta(meta: MetaState): void {
        this._metaState = meta;
        this.emit('meta:updated', meta);
    }

    updateTask(update: Partial<TaskState> & { newResults?: ExecutionResult[] }): void {
        if (update.iteration !== undefined) this._taskState.iteration = update.iteration;
        if (update.currentThinking !== undefined) this._taskState.currentThinking = update.currentThinking;

        if (update.newResults) {
            this._taskState.recentToolCalls = [
                ...this._taskState.recentToolCalls.slice(-15),
                ...update.newResults,
            ];
            for (const r of update.newResults) {
                if (r.success) this._taskState.totalSuccesses++;
                else this._taskState.totalFailures++;
            }
        }

        this._taskState.timestamp = Date.now();
        this.emit('task:updated', this._taskState);
    }

    updatePlan(plan: PlanState): void {
        this._planState = { ...plan, updatedAt: Date.now() };
        this.emit('plan:updated', this._planState);
    }

    /** MetaCognition がサブタスクステータスを部分更新する */
    patchPlanSubtask(subtaskId: string, patch: Partial<PlanSubtask>): void {
        if (!this._planState) return;
        const st = this._planState.subtasks.find(s => s.id === subtaskId);
        if (st) {
            Object.assign(st, patch);
            this._planState.updatedAt = Date.now();
            this._planState.lastUpdatedBy = 'meta_cognition';
            this.emit('plan:updated', this._planState);
        }
    }

    /** 現在の in_progress サブタスクの iterationsSpent をインクリメント */
    incrementSubtaskIteration(): void {
        if (!this._planState?.currentSubtaskId) return;
        const st = this._planState.subtasks.find(s => s.id === this._planState!.currentSubtaskId);
        if (st) st.iterationsSpent++;
    }

    updateInventory(inventory: InventoryEntry[]): void {
        this._inventory = inventory;
    }

    notifyLoopDetected(summary: string): void {
        this.emit('loop:detected', summary);
    }

    // ── Completion ──

    complete(): void {
        if (this._isComplete) return;
        this._isComplete = true;
        this._abortController.abort();
        this.emit('completed');
    }

    // ── Private helpers ──

    private detectEmotionShift(prev: EmotionType, next: EmotionType): boolean {
        const keys = ['joy', 'trust', 'fear', 'surprise', 'sadness', 'disgust', 'anger', 'anticipation'] as const;
        let maxDelta = 0;
        for (const key of keys) {
            const delta = Math.abs(
                (next.parameters[key] ?? 0) - (prev.parameters[key] ?? 0),
            );
            if (delta > maxDelta) maxDelta = delta;
        }
        return maxDelta >= EMOTION_SHIFT_THRESHOLD;
    }
}

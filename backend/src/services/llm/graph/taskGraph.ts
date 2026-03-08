/**
 * TaskGraph: Task Queue Manager
 *
 * Manages task queuing, emergency interrupts, and execution flow.
 * Delegates actual execution to the unified Shannon graph via LLMService.invokeGraph().
 *
 * Used by:
 * - Minebot EventReactionSystem (emergency handling, task queuing)
 * - Minebot SkillAgent (forceStop, task list updates)
 *
 * Does NOT own node initialization — that's handled by NodeFactory.
 */

import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import {
  EmotionType,
  MemoryZone,
  TaskContext,
  TaskTreeState,
  memoryZoneToContext,
} from '@shannon/common';
import type { RequestEnvelope } from '@shannon/common';
import { EventBus } from '../../eventBus/eventBus.js';
import { getEventBus } from '../../eventBus/index.js';
import { createEnvelope } from '../../common/adapters/envelopeFactory.js';
import {
  GRAPH_CONFIG,
  TaskListState,
  TaskQueueEntry,
  TaskStateInput,
} from './types.js';
import { logger } from '../../../utils/logger.js';

/**
 * TaskGraph: task queue manager for Minebot integration.
 *
 * Execution is delegated to the unified Shannon graph.
 * Call setInvokeDelegate() after LLMService initialization to wire up execution.
 */
export class TaskGraph {
  private static instance: TaskGraph;
  private eventBus: EventBus;
  public currentState: any = null;

  // Task queue
  private taskQueue: TaskQueueEntry[] = [];
  private emergencyTask: TaskQueueEntry | null = null;
  private isEmergencyMode = false;
  private isExecuting = false;
  private abortController: AbortController | null = null;

  // Task list update callback
  private onTaskListUpdate: ((tasks: TaskListState) => void) | null = null;

  // Delegate for actual graph execution
  private invokeDelegate: ((envelope: RequestEnvelope, messages?: BaseMessage[]) => Promise<any>) | null = null;

  constructor() {
    this.eventBus = getEventBus();
    this.initializeEventBus();
  }

  public static getInstance(): TaskGraph {
    if (!TaskGraph.instance) {
      TaskGraph.instance = new TaskGraph();
    }
    return TaskGraph.instance;
  }

  /**
   * Wire the execution delegate (called by LLMService after graph initialization).
   */
  public setInvokeDelegate(delegate: (envelope: RequestEnvelope, messages?: BaseMessage[]) => Promise<any>): void {
    this.invokeDelegate = delegate;
  }

  private initializeEventBus() {
    this.eventBus.subscribe('task:stop', () => {
      logger.info('Stopping task');
      this.forceStop();
    });

    this.eventBus.subscribe('task:start', () => {
      logger.info('Resuming tasks');
      this.executeNextTask();
    });
  }

  // ========== Execution (delegates to unified graph) ==========

  /**
   * Execute a task by delegating to the unified Shannon graph.
   * Converts legacy TaskStateInput to RequestEnvelope.
   */
  public async invoke(partialState: TaskStateInput) {
    if (this.isExecuting) {
      logger.warn(`Task already executing, skipping (message: ${partialState.userMessage?.substring(0, 50)})`);
      return null;
    }

    if (!this.invokeDelegate) {
      logger.error('No invoke delegate set — call setInvokeDelegate() first');
      return null;
    }

    this.isExecuting = true;
    this.abortController = new AbortController();

    const taskId = crypto.randomUUID();

    this.currentState = {
      taskId,
      forceStop: false,
      taskTree: {
        status: 'in_progress',
        goal: partialState.userMessage ?? '',
        strategy: '',
        subTasks: null,
      },
    };

    try {
      // Convert to RequestEnvelope
      const envelope = this.taskInputToEnvelope(partialState, taskId);

      // Build messages
      const messages = partialState.messages ?? [];
      if (partialState.userMessage) {
        messages.push(new HumanMessage(partialState.userMessage));
      }

      // Delegate to unified graph
      const graphResult = await this.invokeDelegate(envelope, messages);

      const result = {
        taskId,
        taskTree: graphResult?.taskTree ?? this.currentState.taskTree,
        emotion: graphResult?.emotion ?? null,
        forceStop: false,
      };

      if (result.taskTree?.status === 'in_progress') {
        result.taskTree.status = 'error';
      }

      this.currentState = result;
      return result;
    } catch (error) {
      if (error instanceof Error && (error.name === 'AbortError' || error.message?.includes('abort'))) {
        logger.warn('Task force-stopped');
        return {
          taskId,
          forceStop: true,
          taskTree: { status: 'error', goal: 'Force stopped', strategy: '', subTasks: null },
        };
      }

      logger.error('Task execution error:', error);
      return {
        taskId,
        taskTree: {
          status: 'error',
          goal: `Error: ${error instanceof Error ? error.message : 'unknown'}`,
          strategy: '',
          subTasks: null,
        },
      };
    } finally {
      this.isExecuting = false;
      this.abortController = null;

      if (partialState.isEmergency || this.isEmergencyMode) {
        this.isEmergencyMode = false;
        this.emergencyTask = null;
      }

      const hasPendingTasks = this.taskQueue.some(
        (t) => t.status === 'pending' || t.status === 'paused',
      );
      if (hasPendingTasks && !this.isEmergencyMode) {
        setTimeout(() => this.executeNextTask(), 500);
      }
    }
  }

  // ========== Control ==========

  public forceStop() {
    if (this.currentState) {
      this.currentState.forceStop = true;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  public updateHumanFeedback(feedback: string) {
    if (this.currentState) {
      this.currentState.humanFeedback = feedback;
      this.currentState.humanFeedbackPending = true;
    }
  }

  public isRunning(): boolean {
    return this.isExecuting;
  }

  // ========== Emergency ==========

  public isInEmergencyMode(): boolean {
    return this.isEmergencyMode;
  }

  public interruptForEmergency(message: string): void {
    if (this.isExecuting) {
      this.forceStop();
    }
    this.isEmergencyMode = true;
    // Pause all pending tasks
    for (const task of this.taskQueue) {
      if (task.status === 'executing') task.status = 'paused';
    }
    this.notifyTaskListUpdate();
  }

  public setEmergencyTask(taskInput: TaskStateInput): void {
    const taskId = crypto.randomUUID();
    this.emergencyTask = {
      id: taskId,
      taskTree: { goal: taskInput.userMessage || 'Emergency', status: 'pending' } as any,
      state: taskInput,
      createdAt: Date.now(),
      status: 'executing',
    };
    this.notifyTaskListUpdate();
  }

  // ========== Task Queue ==========

  public addTaskToQueue(
    taskInput: TaskStateInput,
  ): { success: boolean; reason?: string; taskId?: string } {
    if (this.taskQueue.length >= GRAPH_CONFIG.MAX_QUEUE_SIZE) {
      return { success: false, reason: 'Task queue full' };
    }

    const taskId = crypto.randomUUID();
    const task: TaskQueueEntry = {
      id: taskId,
      taskTree: taskInput.taskTree || ({ goal: taskInput.userMessage || 'New Task', status: 'pending' } as any),
      state: taskInput,
      createdAt: Date.now(),
      status: 'pending',
    };

    this.taskQueue.push(task);
    this.notifyTaskListUpdate();

    if (this.taskQueue.length === 1 && !this.isExecuting && !this.isEmergencyMode) {
      this.executeNextTask();
    }

    return { success: true, taskId };
  }

  public removeTask(taskId: string): { success: boolean; reason?: string } {
    const taskIndex = this.taskQueue.findIndex((t) => t.id === taskId);
    if (taskIndex === -1) return { success: false, reason: 'Task not found' };

    const task = this.taskQueue[taskIndex];
    const wasExecuting = task.status === 'executing';
    this.taskQueue.splice(taskIndex, 1);

    if (wasExecuting && this.isExecuting) this.forceStop();
    this.notifyTaskListUpdate();

    if (wasExecuting && !this.isEmergencyMode) this.executeNextTask();
    return { success: true };
  }

  private async executeNextTask(): Promise<void> {
    if (this.isExecuting || this.isEmergencyMode) return;

    const nextTask = this.taskQueue.find((t) => t.status === 'pending' || t.status === 'paused');
    if (!nextTask) return;

    nextTask.status = 'executing';
    this.notifyTaskListUpdate();

    await this.invoke(nextTask.state);
    this.handleTaskCompletion(nextTask.id);
  }

  private handleTaskCompletion(taskId: string): void {
    const taskIndex = this.taskQueue.findIndex((t) => t.id === taskId);
    if (taskIndex !== -1) {
      const task = this.taskQueue[taskIndex];
      const taskStatus = this.currentState?.taskTree?.status;
      if (taskStatus === 'error') {
        task.status = 'paused';
        task.taskTree = this.currentState?.taskTree || task.taskTree;
      } else {
        this.taskQueue.splice(taskIndex, 1);
      }
    }

    this.notifyTaskListUpdate();

    const taskStatus = this.currentState?.taskTree?.status;
    if (!this.isEmergencyMode && taskStatus !== 'error') {
      setTimeout(() => this.executeNextTask(), 500);
    }
  }

  // ========== Task List State ==========

  public getTaskListState(): TaskListState {
    return {
      tasks: this.taskQueue.map((t) => ({
        id: t.id,
        goal: t.taskTree?.goal || 'Unknown',
        status: t.status,
        createdAt: t.createdAt,
      })),
      emergencyTask: this.emergencyTask
        ? { id: this.emergencyTask.id, goal: this.emergencyTask.taskTree?.goal || 'Emergency', createdAt: this.emergencyTask.createdAt }
        : null,
      currentTaskId: this.isExecuting
        ? this.taskQueue.find((t) => t.status === 'executing')?.id || null
        : null,
    };
  }

  public setTaskListUpdateCallback(callback: (tasks: TaskListState) => void): void {
    this.onTaskListUpdate = callback;
  }

  private notifyTaskListUpdate(): void {
    if (this.onTaskListUpdate) {
      this.onTaskListUpdate(this.getTaskListState());
    }
  }

  // ========== Conversion ==========

  private taskInputToEnvelope(input: TaskStateInput, taskId: string): RequestEnvelope {
    const platform = input.context?.platform ?? 'web';
    const channelMap: Record<string, string> = {
      discord: 'discord', twitter: 'x', minebot: 'minecraft', minecraft: 'minecraft',
      web: 'web', youtube: 'youtube',
    };
    const channel = (channelMap[platform] ?? 'web') as any;

    const tags: string[] = [channel];
    if (input.isEmergency) tags.push('emergency');

    return createEnvelope({
      channel,
      sourceUserId: input.context?.discord?.userId ?? 'minebot',
      sourceDisplayName: input.context?.discord?.userName,
      conversationId: input.context?.conversationId ?? input.channelId ?? channel,
      threadId: input.channelId ?? channel,
      text: input.userMessage ?? undefined,
      tags,
      discord: input.context?.discord ? {
        guildId: input.context.discord.guildId,
        guildName: input.context.discord.guildName,
        channelId: input.context.discord.channelId,
        channelName: input.context.discord.channelName,
        messageId: input.context.discord.messageId,
      } : undefined,
      metadata: {
        environmentState: input.environmentState,
        selfState: input.selfState,
        legacyMemoryZone: input.memoryZone,
        taskId,
      },
    });
  }
}

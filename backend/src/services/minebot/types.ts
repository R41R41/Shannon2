import { Bot, BotEvents, Dimension } from 'mineflayer';
import { CommandManager } from 'mineflayer-cmd';
import { goals } from 'mineflayer-pathfinder';
import { Block } from 'prismarine-block';
import { Entity } from 'prismarine-entity';
import { Vec3 } from 'vec3';
import { Utils } from './utils/index.js';

export type Goal = goals.Goal;

export type Hand = 'hand' | 'off-hand';

export type ToolCategory =
  | 'weapon'
  | 'sword'
  | 'pickaxe'
  | 'shovel'
  | 'hoe'
  | 'shears'
  | 'bow'
  | 'arrow'
  | 'fishing rod'
  | 'snowball'
  | 'shield';

export type Material =
  | 'wood'
  | 'stone'
  | 'iron'
  | 'diamond'
  | 'gold'
  | 'netherite';

export type ArmorCategory =
  | 'helmet'
  | 'chestplate'
  | 'leggings'
  | 'boots'
  | 'elytra';

// BotEventsを拡張
interface CustomBotEvents extends BotEvents {
  [key: `taskPer${number}ms`]: () => void;
}

export type DroppedItem = {
  isDroppedItem: boolean;
  name: string;
  position: Vec3 | null;
  metadata: any;
};

// CustomBotの定義を更新
export interface CustomBot extends Omit<Bot, 'on' | 'once' | 'emit'> {
  on<K extends keyof CustomBotEvents>(
    event: K,
    listener: CustomBotEvents[K]
  ): CustomBot;
  once<K extends keyof CustomBotEvents>(
    event: K,
    listener: CustomBotEvents[K]
  ): CustomBot;
  emit<K extends keyof CustomBotEvents>(
    event: K,
    ...args: Parameters<CustomBotEvents[K]>
  ): boolean;
  isTest: boolean;
  chatMode: boolean;
  attackEntity: Entity | null;
  runFromEntity: Entity | null;
  goal: Goal | null;
  instantSkills: InstantSkills;
  constantSkills: ConstantSkills;
  utils: Utils;
  isInWater: boolean;
  cmd: CommandManager;
  executingSkill: boolean;
  environmentState: {
    senderName: string;
    senderPosition: Vec3 | null;
    weather: string;
    time: string;
    biome: string;
    dimension: Dimension | null;
    bossbar: string | null;
  };
  selfState: {
    botPosition: Vec3 | null;
    botHealth: string;
    botFoodLevel: string;
    botHeldItem: string;
    lookingAt: Block | Entity | DroppedItem | null;
    inventory: { name: string; count: number }[];
  };
}

export abstract class Skill {
  skillName: string;
  description: string;
  status: boolean;
  bot: CustomBot;
  isToolForLLM: boolean;
  constructor(bot: CustomBot) {
    this.skillName = 'skill';
    this.description = 'skill';
    this.status = true;
    this.bot = bot;
    this.isToolForLLM = true;
  }
}

export abstract class ConstantSkill extends Skill {
  priority: number;
  isLocked: boolean;
  interval: number | null;
  args: any;
  containMovement: boolean;
  constructor(bot: CustomBot) {
    super(bot);
    this.priority = 0;
    this.containMovement = false;
    this.isLocked = false;
    this.interval = null;
    this.args = {};
  }
  lock() {
    if (this.isLocked) return;
    this.isLocked = true;
  }
  unlock() {
    if (!this.isLocked) return;
    this.isLocked = false;
  }

  async run(...args: any[]): Promise<void> {
    if (this.isLocked) return;

    // containMovementがtrueの場合、優先度チェックとInstantSkill実行チェックを行う
    if (this.containMovement) {
      // InstantSkillが実行中の場合は実行しない
      if (this.bot.executingSkill) return;

      // 優先度の高いConstantSkillが実行中の場合は実行しない
      const runningSkills = this.bot.constantSkills
        .getSkills()
        .filter((skill) => skill.containMovement && skill.isLocked && skill.priority > this.priority);
      if (runningSkills.length > 0) return;
    }

    this.isLocked = true;
    try {
      await this.runImpl(...args);
    } finally {
      this.isLocked = false;
    }
  }

  protected abstract runImpl(...args: any[]): Promise<void>;
}

export abstract class InstantSkill extends Skill {
  priority: number;
  status: boolean;
  params: any[];
  canUseByCommand: boolean;
  constructor(bot: CustomBot) {
    super(bot);
    this.priority = 0;
    this.status = false;
    this.params = [];
    this.canUseByCommand = true;
  }

  async run(...args: any[]): Promise<{ success: boolean; result: string }> {
    this.bot.executingSkill = true;
    this.status = true;
    try {
      return await this.runImpl(...args);
    } finally {
      this.bot.executingSkill = false;
      this.status = false;
    }
  }

  abstract runImpl(
    ...args: any[]
  ): Promise<{ success: boolean; result: string }>;
}

export class InstantSkills {
  skills: InstantSkill[];
  constructor() {
    this.skills = [];
  }
  addSkill(skill: InstantSkill) {
    this.skills.push(skill);
  }
  getSkill(name: string): InstantSkill | undefined {
    return this.skills.find((skill) => skill.skillName === name);
  }
  getSkills(): InstantSkill[] {
    return this.skills;
  }
}

// タスクキューのエントリー型
export type TaskQueueEntry = {
  skill: ConstantSkill;
  startTime: number;
  args: any[];
};

// タスクキューの状態型
export type TaskQueueState = {
  isProcessing: boolean;
  queue: TaskQueueEntry[];
  currentTask: TaskQueueEntry | null;
};

// 優先度付きキュー（ヒープベース）
class PriorityQueue {
  private heap: TaskQueueEntry[];

  constructor() {
    this.heap = [];
  }

  // 親ノードのインデックスを取得
  private parentIndex(index: number): number {
    return Math.floor((index - 1) / 2);
  }

  // 左の子ノードのインデックスを取得
  private leftChildIndex(index: number): number {
    return 2 * index + 1;
  }

  // 右の子ノードのインデックスを取得
  private rightChildIndex(index: number): number {
    return 2 * index + 2;
  }

  // ノードを上に移動（優先度が高い場合）
  private bubbleUp(index: number) {
    const parent = this.parentIndex(index);
    if (index > 0 && this.heap[parent].skill.priority < this.heap[index].skill.priority) {
      [this.heap[parent], this.heap[index]] = [this.heap[index], this.heap[parent]];
      this.bubbleUp(parent);
    }
  }

  // ノードを下に移動（優先度が低い場合）
  private bubbleDown(index: number) {
    const left = this.leftChildIndex(index);
    const right = this.rightChildIndex(index);
    let largest = index;

    if (left < this.heap.length && this.heap[left].skill.priority > this.heap[largest].skill.priority) {
      largest = left;
    }

    if (right < this.heap.length && this.heap[right].skill.priority > this.heap[largest].skill.priority) {
      largest = right;
    }

    if (largest !== index) {
      [this.heap[index], this.heap[largest]] = [this.heap[largest], this.heap[index]];
      this.bubbleDown(largest);
    }
  }

  // タスクの追加（O(log n)）
  push(task: TaskQueueEntry) {
    this.heap.push(task);
    this.bubbleUp(this.heap.length - 1);
  }

  // タスクの取り出し（O(log n)）
  pop(): TaskQueueEntry | undefined {
    if (this.heap.length === 0) return undefined;

    const result = this.heap[0];
    const last = this.heap.pop()!;

    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }

    return result;
  }

  // キューの長さを取得
  length(): number {
    return this.heap.length;
  }

  // キューを配列として取得
  toArray(): TaskQueueEntry[] {
    return [...this.heap];
  }

  // キューをクリア
  clear() {
    this.heap = [];
  }
}

export class ConstantSkills {
  skills: ConstantSkill[];
  private taskQueue: PriorityQueue;
  private isProcessing: boolean;
  private currentTask: TaskQueueEntry | null;
  private readonly MAX_QUEUE_SIZE = 10;
  private readonly TASK_TIMEOUT = 10000; // 10秒
  private processInterval: NodeJS.Timeout | null;

  constructor() {
    this.skills = [];
    this.taskQueue = new PriorityQueue();
    this.isProcessing = false;
    this.currentTask = null;
    this.processInterval = null;
    this.startProcessing();
  }

  // 定期的なタスク処理を開始
  private startProcessing() {
    if (this.processInterval) return;

    this.processInterval = setInterval(() => {
      if (!this.isProcessing && this.taskQueue.length() > 0) {
        this.processNextTask();
      }
    }, 100); // 100msごとにチェック
  }

  // 定期的なタスク処理を停止
  private stopProcessing() {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
  }

  // タスクをキューに追加
  private addToQueue(skill: ConstantSkill, args: any[] = []) {
    const entry: TaskQueueEntry = {
      skill,
      startTime: Date.now(),
      args
    };

    this.taskQueue.push(entry);

    // キューサイズの制限
    if (this.taskQueue.length() > this.MAX_QUEUE_SIZE) {
      // 優先度の低いタスクを削除
      const tasks = this.taskQueue.toArray();
      tasks.sort((a, b) => a.skill.priority - b.skill.priority);
      this.taskQueue.clear();
      tasks.slice(0, this.MAX_QUEUE_SIZE).forEach(task => this.taskQueue.push(task));
    }

    // console.log("taskQueue", this.taskQueue.toArray().map(task =>
    //   `${task.skill.skillName}:${task.skill.priority}`
    // ));
  }

  // 次のタスクを処理
  private async processNextTask() {
    if (this.isProcessing || this.taskQueue.length() === 0) return;

    this.isProcessing = true;
    this.currentTask = this.taskQueue.pop()!;

    try {
      // タイムアウト処理
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Task timeout')), this.TASK_TIMEOUT);
      });

      // タスク実行
      await Promise.race([
        this.currentTask.skill.run(...this.currentTask.args),
        timeoutPromise
      ]);
    } catch (error) {
      console.error(`Task execution error: ${error}`);
    } finally {
      this.isProcessing = false;
      this.currentTask = null;
    }
  }

  // スキルの実行を要求
  async requestExecution(skill: ConstantSkill, args: any[] = []) {
    this.addToQueue(skill, args);
  }

  // キューのクリア
  clearQueue() {
    this.taskQueue.clear();
    this.isProcessing = false;
    this.currentTask = null;
  }

  // デストラクタ
  destroy() {
    this.stopProcessing();
    this.clearQueue();
  }

  // 既存のメソッド
  addSkill(skill: ConstantSkill) {
    this.skills.push(skill);
  }

  getSkill(name: string): ConstantSkill | undefined {
    return this.skills.find((skill) => skill.skillName === name);
  }

  getSkills(): ConstantSkill[] {
    return this.skills;
  }

  // キューの状態を取得
  getQueueState(): TaskQueueState {
    return {
      isProcessing: this.isProcessing,
      queue: this.taskQueue.toArray(),
      currentTask: this.currentTask
    };
  }
}

export type ResponseType = {
  success: boolean;
  result: string;
};

export type Param = {
  name: string;
  description: string;
  type: string;
  default: string;
};

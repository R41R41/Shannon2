import { Bot, BotEvents } from 'mineflayer';
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
    dimension: string;
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
        .filter((skill) => skill.isLocked && skill.priority > this.priority);
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

export class ConstantSkills {
  skills: ConstantSkill[];
  constructor() {
    this.skills = [];
  }
  addSkill(skill: ConstantSkill) {
    this.skills.push(skill);
  }
  getSkill(name: string): ConstantSkill | undefined {
    return this.skills.find((skill) => skill.skillName === name);
  }
  getSkills(): ConstantSkill[] {
    return this.skills;
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

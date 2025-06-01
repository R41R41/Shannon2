import { Bot, BotEvents } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import { Entity } from 'prismarine-entity';
import { Utils } from './utils/index.js';
import { CommandManager } from 'mineflayer-cmd';
import { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';

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
  lookingAt: Block | Entity | DroppedItem | null;
  executingSkill: boolean;
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
  constructor(bot: CustomBot) {
    super(bot);
    this.priority = 0;
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
  abstract run(...args: any[]): Promise<void>;
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
    try {
      return await this.runImpl(...args);
    } finally {
      this.bot.executingSkill = false;
    }
  }

  abstract runImpl(...args: any[]): Promise<{ success: boolean; result: string }>;
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

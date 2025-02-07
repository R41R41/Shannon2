import { Bot, BotEvents } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import { Entity } from 'prismarine-entity';
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
}

export abstract class Skill {
  skillName: string;
  description: string;
  status: boolean;
  bot: CustomBot;
  constructor(bot: CustomBot) {
    this.skillName = 'skill';
    this.description = 'skill';
    this.status = true;
    this.bot = bot;
  }
  abstract run(...args: any[]): Promise<{
    success: boolean;
    result: string;
  }>;
}

export abstract class ConstantSkill extends Skill {
  priority: number;
  isLocked: boolean;
  interval: number;
  constructor(bot: CustomBot) {
    super(bot);
    this.priority = 0;
    this.isLocked = false;
    this.interval = 1000;
  }
  lock() {
    if (this.isLocked) return;
    this.isLocked = true;
  }
  unlock() {
    if (!this.isLocked) return;
    this.isLocked = false;
  }
  abstract run(...args: any[]): Promise<{
    success: boolean;
    result: string;
  }>;
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
  abstract run(...args: any[]): Promise<{
    success: boolean;
    result: string;
  }>;
}

export class InstantSkills {
  skills: { [key: string]: InstantSkill };
  constructor() {
    this.skills = {};
  }
  addSkill(skill: InstantSkill) {
    this.skills[skill.skillName] = skill;
  }
  getSkill(name: string): InstantSkill {
    return this.skills[name];
  }
  getSkills(): { [key: string]: InstantSkill } {
    return this.skills;
  }
}

export class ConstantSkills {
  skills: { [key: string]: ConstantSkill };
  constructor() {
    this.skills = {};
  }
  addSkill(skill: ConstantSkill) {
    this.skills[skill.skillName] = skill;
  }
  getSkill(name: string): ConstantSkill {
    return this.skills[name];
  }
  getSkills(): { [key: string]: ConstantSkill } {
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

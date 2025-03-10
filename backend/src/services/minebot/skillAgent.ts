import { MinebotInput, MinebotSkillInput } from '@shannon/common';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { EventBus } from '../eventBus/eventBus.js';
import {
  ConstantSkills,
  CustomBot,
  InstantSkills,
  ResponseType,
  ConstantSkill,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class SkillAgent {
  private instantSkillDir: string;
  private constantSkillDir: string;
  private bot: CustomBot;
  private eventBus: EventBus;

  constructor(bot: CustomBot, eventBus: EventBus) {
    this.bot = bot;
    this.eventBus = eventBus;
    this.instantSkillDir = join(__dirname, 'instantSkills');
    this.constantSkillDir = join(__dirname, 'constantSkills');
  }

  async loadInstantSkills(): Promise<ResponseType> {
    try {
      this.eventBus.log('minecraft', 'blue', 'loadInstantSkills');
      const files = fs.readdirSync(this.instantSkillDir);
      for (const file of files) {
        try {
          if (file.endsWith('.js')) {
            const { default: skillClass } = await import(
              join(this.instantSkillDir, file)
            );
            const skillInstance = new skillClass(this.bot);
            console.log(`\x1b[32m✓ ${skillInstance.skillName}\x1b[0m`);
            this.bot.instantSkills.addSkill(skillInstance);
          }
        } catch (error) {
          return {
            success: false,
            result: `${file}の読み込みに失敗しました: ${error}`,
          };
        }
      }
      return { success: true, result: 'instantSkills loaded' };
    } catch (error) {
      return { success: false, result: `error: ${error}` };
    }
  }

  async loadConstantSkills(): Promise<ResponseType> {
    try {
      this.eventBus.log('minecraft', 'blue', 'loadConstantSkills');
      const files = fs.readdirSync(this.constantSkillDir);
      for (const file of files) {
        try {
          if (file.endsWith('.js')) {
            const { default: skillClass } = await import(
              join(this.constantSkillDir, file)
            );
            const skillInstance = new skillClass(this.bot);
            this.eventBus.log(
              'minecraft',
              'green',
              `✓ ${skillInstance.skillName}`
            );
            this.bot.constantSkills.addSkill(skillInstance);
          }
        } catch (error) {
          return {
            success: false,
            result: `${file}の読み込みに失敗しました: ${error}`,
          };
        }
      }
      return { success: true, result: 'constantSkills loaded' };
    } catch (error) {
      return { success: false, result: `error: ${error}` };
    }
  }

  async registerRoutes() {
    this.eventBus.log('minecraft', 'blue', 'registerRoutes');
    this.bot.instantSkills.getSkills().forEach((skill) => {
      this.eventBus.log('minecraft', 'green', `✓ ${skill.skillName}`);
      this.eventBus.subscribe(`minebot:${skill.skillName}`, async (event) => {
        try {
          const data = event.data as any;
          if (skill.status) {
            this.eventBus.publish({
              type: `minebot:skillResult`,
              memoryZone: 'minecraft',
              data: {
                skillName: skill.skillName,
                success: false,
                result: `already active`,
              },
            });
            return;
          }
          skill.status = true;
          const response = await skill.run(...data);
          skill.status = false;
          this.eventBus.publish({
            type: `minebot:skillResult`,
            memoryZone: 'minecraft',
            data: {
              skillName: skill.skillName,
              success: response.success,
              result: response.result,
            },
          });
        } catch (error) {
          this.eventBus.log(
            'minecraft',
            'red',
            `${skill.skillName} error: ${error}`
          );
          this.eventBus.publish({
            type: `minebot:skillResult`,
            memoryZone: 'minecraft',
            data: {
              skillName: skill.skillName,
              success: false,
              result: `error: ${error}`,
            },
          });
        }
      });
    });
  }

  async registerConstantSkills() {
    this.eventBus.log('minecraft', 'blue', 'registerConstantSkills');
    this.bot.constantSkills.getSkills().forEach((skill) => {
      if (skill.interval && skill.interval > 0) {
        this.eventBus.log(
          'minecraft',
          'green',
          `✓ ${skill.skillName} ${skill.interval}ms`
        );
        this.bot.on(`taskPer${skill.interval}ms`, async () => {
          if (skill.status && !skill.isLocked) {
            try {
              await skill.run();
            } catch (error) {
              this.eventBus.log(
                'minecraft',
                'red',
                `${skill.skillName} error: ${error}`
              );
            }
          }
        });
      }
    });
  }

  async setInterval() {
    setInterval(() => {
      this.bot.emit('taskPer100ms');
    }, 100);

    setInterval(() => {
      this.bot.emit('taskPer1000ms');
    }, 1000);

    setInterval(() => {
      this.bot.emit('taskPer10000ms');
    }, 10000);
  }

  async registerPost() {
    this.eventBus.subscribe('minebot:stopInstantSkill', async (event) => {
      try {
        const { skillName } = event.data as MinebotSkillInput;
        if (!skillName) {
          return;
        }
        const InstantSkill = this.bot.instantSkills.getSkill(skillName);
        if (!InstantSkill) {
          this.bot.chat(`${skillName}は存在しません`);
          return;
        }
        InstantSkill.status = false;
        this.eventBus.publish({
          type: `minebot:skillResult`,
          memoryZone: 'minecraft',
          data: {
            skillName: skillName,
            success: true,
            result: `${skillName} stopped`,
          },
        });
      } catch (error) {
        const { skillName } = event.data as MinebotSkillInput;
        this.eventBus.publish({
          type: `minebot:skillResult`,
          memoryZone: 'minecraft',
          data: {
            skillName: skillName,
            success: false,
            result: `error: ${error}`,
          },
        });
      }
    });

    this.eventBus.subscribe('minebot:getInstantSkills', async (event) => {
      try {
        const formattedResponse = this.bot.instantSkills
          .getSkills()
          .map((skill) => {
            const description = skill.description;
            return `skillName: ${skill.skillName}, description: ${description}`;
          })
          .join('\n');
        this.eventBus.publish({
          type: `minebot:skillResult`,
          memoryZone: 'minecraft',
          data: {
            success: true,
            result: formattedResponse,
          },
        });
      } catch (error) {
        this.eventBus.publish({
          type: `minebot:skillResult`,
          memoryZone: 'minecraft',
          data: {
            success: false,
            result: `error: ${error}`,
          },
        });
      }
    });

    this.eventBus.subscribe('minebot:loadSkills', async (event) => {
      try {
        const initSkillsResponse = await this.initSkills();
        if (!initSkillsResponse.success) {
          console.log(`error: ${initSkillsResponse.result}`);
          this.eventBus.publish({
            type: `minebot:skillResult`,
            memoryZone: 'minecraft',
            data: {
              success: false,
              result: initSkillsResponse.result,
            },
          });
          return;
        }
        this.eventBus.publish({
          type: `minebot:skillResult`,
          memoryZone: 'minecraft',
          data: {
            success: true,
            result: initSkillsResponse.result,
          },
        });
      } catch (error) {
        this.eventBus.publish({
          type: `minebot:skillResult`,
          memoryZone: 'minecraft',
          data: {
            success: false,
            result: `error: ${error}`,
          },
        });
      }
    });
  }

  async initSkills() {
    this.bot.instantSkills = new InstantSkills();
    this.bot.constantSkills = new ConstantSkills();
    const instantSkillsResponse = await this.loadInstantSkills();
    if (!instantSkillsResponse.success) {
      return { success: false, result: instantSkillsResponse.result };
    }
    const constantSkillsResponse = await this.loadConstantSkills();
    if (!constantSkillsResponse.success) {
      return { success: false, result: constantSkillsResponse.result };
    }
    await this.registerRoutes();
    await this.registerConstantSkills();
    return { success: true, result: 'skills loaded' };
  }

  async botOnChat() {
    this.bot.on('chat', async (username, message) => {
      if (!this.bot.chatMode) {
        return;
      }
      if (username === 'I_am_Sh4nnon') {
        return;
      }
      console.log(`[${username}] ${message}`);
      if (!message) {
        return;
      }
      if (message === '..') {
        const displayInstantSkillList = this.bot.instantSkills.getSkill(
          'display-instant-skill-list'
        );
        if (!displayInstantSkillList) {
          this.bot.chat('display-instant-skill-listは存在しません');
          return;
        }
        console.log('here');
        const response = await displayInstantSkillList.run();
        if (!response.success) {
          this.bot.chat(`display-instant-skill-list error: ${response.result}`);
        }
        return;
      }
      if (message === '...') {
        const displayConstantSkillList = this.bot.instantSkills.getSkill(
          'display-constant-skill-list'
        );
        if (!displayConstantSkillList) {
          this.bot.chat('display-constant-skill-listは存在しません');
          return;
        }
        const response = await displayConstantSkillList.run();
        if (!response.success) {
          this.bot.chat(
            `display-constant-skill-list error: ${response.result}`
          );
        }
        return;
      }
      if (message === '.../') {
        const displayInventory =
          this.bot.instantSkills.getSkill('display-inventory');
        if (!displayInventory) {
          this.bot.chat('display-inventoryは存在しません');
          return;
        }
        const response = await displayInventory.run();
        if (!response.success) {
          this.bot.chat(`display-inventory error: ${response.result}`);
        }
        return;
      }
      if (message.startsWith('./')) {
        const [skillName, ...args] = message.slice(2).split(' ');
        try {
          const InstantSkill = this.bot.instantSkills.getSkill(skillName);
          if (!InstantSkill) {
            this.bot.chat(`${skillName}は存在しません`);
            return;
          }
          if (InstantSkill.status) {
            this.bot.chat(`${skillName}を停止します`);
            InstantSkill.status = false;
            return;
          }
          const paramsResponse = await this.bot.utils.getParams(
            this.bot,
            InstantSkill.params
          );
          if (!paramsResponse.success) {
            this.bot.chat(`${skillName} error: ${paramsResponse.result}`);
            return;
          }
          InstantSkill.status = true;
          const response = await InstantSkill.run(
            ...Object.values(paramsResponse.result)
          );
          InstantSkill.status = false;
          console.log(`${skillName} ${response.result}`);
          if (response.success) {
            this.bot.chat(response.result);
          } else {
            this.bot.chat(`${skillName} error: ${response.result}`);
          }
        } catch (error) {
          console.log(`${skillName} error: ${error}`);
          this.bot.chat(`${skillName} error: ${error}`);
        }
        return;
      }
      if (message.startsWith('../')) {
        const skillName = message.slice(3);
        if (!this.bot.constantSkills.getSkill(skillName)) {
          this.bot.chat(`${skillName}は存在しません`);
          return;
        }
        const ConstantSkill = this.bot.constantSkills.getSkill(skillName);
        if (!ConstantSkill) {
          this.bot.chat(`${skillName}は存在しません`);
          return;
        }
        ConstantSkill.status = !ConstantSkill.status;
        this.bot.chat(
          `常時スキル${skillName}のステータスを${
            ConstantSkill.status ? 'オン' : 'オフ'
          }にしました`
        );
        return;
      }
      const sender = this.bot.players[username]?.entity;
      const data = {
        senderName: username,
        message: message,
        senderPosition: sender.position.toString(),
        botPosition: this.bot.entity.position.toString(),
        botHealth: `${this.bot.health}/20`,
        botFoodLevel: `${this.bot.food}/20`,
      };
      this.eventBus.publish({
        type: 'minebot:chat',
        memoryZone: 'minecraft',
        data: data,
      });
    });
    this.eventBus.subscribe('minebot:chat', async (event) => {
      const { text } = event.data as MinebotSkillInput;
      if (text) {
        this.bot.chat(text);
      }
    });
  }

  async entitySpawn() {
    console.log(`\x1b[32m✓ entitySpawn\x1b[0m`);
    this.bot.on('entitySpawn', async (entity) => {});
  }

  async entityHurt() {
    console.log(`\x1b[32m✓ entityHurt\x1b[0m`);
    this.bot.on('entityHurt', async (entity) => {
      if (entity === this.bot.entity) {
        this.bot.chat(`ダメージを受けました: ${this.bot.health.toFixed(1)}/20`);
      }
    });
  }

  async health() {
    console.log(`\x1b[32m✓ health\x1b[0m`);
    this.bot.on('health', async () => {
      const autoEat = this.bot.constantSkills.getSkill('auto-eat');
      if (!autoEat) {
        this.bot.chat('auto-eatは存在しません');
        return;
      }
      if (!autoEat.status) return;
      if (autoEat.isLocked) return;
      try {
        await autoEat.run();
      } catch (error) {
        console.error('エラーが発生しました:', error);
      }
    });
  }

  async entityMoved() {
    console.log(`\x1b[32m✓ entityMoved\x1b[0m`);
    this.bot.on('entityMoved', async (entity) => {
      if (entity.type !== 'projectile') return;
      const autoAvoidProjectile = this.bot.constantSkills.getSkill(
        'auto-avoid-projectile'
      );
      if (!autoAvoidProjectile) {
        this.bot.chat('auto-avoid-projectileは存在しません');
        return;
      }
      if (autoAvoidProjectile.isLocked) return;
      try {
        await autoAvoidProjectile.run(entity);
      } catch (error) {
        console.error('エラーが発生しました:', error);
      }
    });
  }

  async startAgent() {
    try {
      const initSkillsResponse = await this.initSkills();
      if (!initSkillsResponse.success) {
        return { success: false, result: initSkillsResponse.result };
      }
      await this.setInterval();
      await this.registerPost();
      await this.botOnChat();
      await this.entitySpawn();
      await this.entityMoved();
      await this.entityHurt();
      await this.health();
      return { success: true, result: 'agent started' };
    } catch (error) {
      console.log(`error: ${error}`);
      return { success: false, result: error };
    }
  }
}

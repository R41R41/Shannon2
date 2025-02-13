import { MinebotInput, MinebotSkillInput } from '@shannon/common';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { EventBus } from '../eventBus.js';
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
    Object.keys(this.bot.instantSkills.skills).forEach((skillName) => {
      this.eventBus.log('minecraft', 'green', `✓ ${skillName}`);
      this.eventBus.subscribe(`minebot:${skillName}`, async (event) => {
        try {
          const data = event.data;
          const InstantSkill = this.bot.instantSkills.getSkill(skillName);
          if (InstantSkill.status) {
            this.eventBus.publish({
              type: `minebot:skillResult`,
              memoryZone: 'minecraft',
              data: {
                skillName: skillName,
                success: false,
                result: `already active`,
              },
            });
            return;
          }
          const params = await this.bot.utils.getParams(
            this.bot,
            data,
            InstantSkill.params,
            []
          );
          this.eventBus.log(
            'minecraft',
            'white',
            `params: ${JSON.stringify(params)}`
          );
          InstantSkill.status = true;
          const response = await InstantSkill.run(...Object.values(params));
          InstantSkill.status = false;
          this.eventBus.publish({
            type: `minebot:skillResult`,
            memoryZone: 'minecraft',
            data: {
              skillName: skillName,
              success: response.success,
              result: response.result,
            },
          });
        } catch (error) {
          this.eventBus.log('minecraft', 'red', `${skillName} error: ${error}`);
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
    });
  }

  async registerConstantSkills() {
    this.eventBus.log('minecraft', 'blue', 'registerConstantSkills');
    Object.keys(this.bot.constantSkills.skills).forEach((skillName) => {
      const skillInstance = this.bot.constantSkills.getSkill(
        skillName
      ) as ConstantSkill;
      if (skillInstance.interval && skillInstance.interval > 0) {
        this.eventBus.log(
          'minecraft',
          'green',
          `✓ ${skillName} ${skillInstance.interval}ms`
        );
        this.bot.on(`taskPer${skillInstance.interval}ms`, async () => {
          if (skillInstance.status && !skillInstance.isLocked) {
            try {
              await skillInstance.run();
            } catch (error) {
              this.eventBus.log(
                'minecraft',
                'red',
                `${skillName} error: ${error}`
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
        this.bot.instantSkills.getSkill(skillName).status = false;
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
        const formattedResponse = Object.keys(this.bot.instantSkills)
          .map((skillName) => {
            const description =
              this.bot.instantSkills.getSkill(skillName).description;
            return `skillName: ${skillName}, description: ${description}`;
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
        try {
          await this.bot.instantSkills.skills.displayInstantSkillList.run();
        } catch (error) {
          console.log(`display-instant-skill-list error: ${error}`);
          this.bot.chat(`display-instant-skill-list error: ${error}`);
        }
        return;
      }
      if (message === '...') {
        try {
          await this.bot.constantSkills.skills.displayConstantSkillList.run();
        } catch (error) {
          console.log(`display-constant-skill-list error: ${error}`);
          this.bot.chat(`display-constant-skill-list error: ${error}`);
        }
        return;
      }
      if (message === '.../') {
        try {
          await this.bot.instantSkills.skills.displayInventory.run();
        } catch (error) {
          console.log(`display-inventory error: ${error}`);
          this.bot.chat(`display-inventory error: ${error}`);
        }
        return;
      }
      if (message.startsWith('./')) {
        const [skillName, ...args] = message.slice(2).split(' ');
        if (!this.bot.instantSkills.skills[skillName]) {
          this.bot.chat(`${skillName}は存在しません`);
          return;
        }
        try {
          const InstantSkill = this.bot.instantSkills.skills[skillName];
          if (InstantSkill.status) {
            this.bot.chat(`${skillName}を停止します`);
            InstantSkill.status = false;
            return;
          }
          console.log(`${skillName} ${args}`);
          const params = await this.bot.utils.getParams(
            this.bot,
            {
              skillName: skillName,
              args: args,
            },
            InstantSkill.params,
            []
          );
          console.log(`params: ${JSON.stringify(params)}`);
          if (params.error) {
            this.bot.chat(`${skillName} error: ${params.result}`);
            return;
          }
          InstantSkill.status = true;
          const response = await InstantSkill.run(...Object.values(params));
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
        if (!this.bot.constantSkills.skills[skillName]) {
          this.bot.chat(`${skillName}は存在しません`);
          return;
        }
        this.bot.constantSkills.skills[skillName].status =
          !this.bot.constantSkills.skills[skillName].status;
        this.bot.chat(
          `常時スキル${skillName}のステータスを${
            this.bot.constantSkills.skills[skillName].status ? 'オン' : 'オフ'
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
      if (!this.bot.constantSkills.skills.autoEat.status) return;
      if (this.bot.constantSkills.skills.autoEat.isLocked) return;
      try {
        await this.bot.constantSkills.skills.autoEat.run();
      } catch (error) {
        console.error('エラーが発生しました:', error);
      }
    });
  }

  async entityMoved() {
    console.log(`\x1b[32m✓ entityMoved\x1b[0m`);
    this.bot.on('entityMoved', async (entity) => {
      if (entity.type !== 'projectile') return;
      if (!this.bot.constantSkills.skills.autoAvoidProjectile.status) return;
      if (this.bot.constantSkills.skills.autoAvoidProjectile.isLocked) return;
      try {
        await this.bot.constantSkills.skills.autoAvoidProjectile.run(entity);
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

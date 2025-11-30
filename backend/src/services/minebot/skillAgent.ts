import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { MinebotSkillInput } from '@shannon/common';
import express, { Application } from 'express';
import fs from 'fs';
import { Server } from 'http';
import fetch from 'node-fetch';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Vec3 } from 'vec3';
import { EventBus } from '../eventBus/eventBus.js';
import { CentralAgent } from './llm/graph/centralAgent.js';
import {
  ConstantSkills,
  CustomBot,
  InstantSkills,
  ResponseType,
} from './types.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class SkillAgent {
  private instantSkillDir: string;
  private constantSkillDir: string;
  private bot: CustomBot;
  private eventBus: EventBus;
  public centralAgent: CentralAgent;
  private recentMessages: BaseMessage[] = [];
  private app: Application;
  public server: Server | null = null;
  constructor(bot: CustomBot, eventBus: EventBus) {
    this.bot = bot;
    this.eventBus = eventBus;
    this.instantSkillDir = join(__dirname, 'instantSkills');
    this.constantSkillDir = join(__dirname, 'constantSkills');
    this.centralAgent = CentralAgent.getInstance(this.bot);
    this.recentMessages = [];
    this.app = express();
    this.setupExpressServer();
  }

  async setupExpressServer() {
    this.app.use(express.json());
    this.app.post('/throw_item', (req: any, res: any) => {
      const { itemName } = req.body;
      const throwItem = this.bot.instantSkills.getSkill('throw-item');
      if (!throwItem) {
        return res
          .status(404)
          .json({ success: false, result: 'throw-item not found' });
      }
      throwItem.run(itemName.split(':')[1]);
      res.status(200).json({ success: true, result: 'throw-item executed' });
    });
    this.app.post('/constant_skill_switch', async (req: any, res: any) => {
      try {
        const { skillName, status } = req.body;
        const constantSkill = this.bot.constantSkills.getSkill(skillName);
        if (!constantSkill) {
          return res
            .status(404)
            .json({ success: false, result: 'constant skill not found' });
        }
        constantSkill.status = status === 'true';
        // JSONファイルを更新
        const jsonPath = join(__dirname, '../../../saves/minecraft/constantSkills.json');
        let savedSkills: { skillName: string; status: boolean }[] = [];
        try {
          if (fs.existsSync(jsonPath)) {
            const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
            savedSkills = JSON.parse(jsonContent);
          }
        } catch (e) {
          console.error('constantSkills.json読み込みエラー:', e);
        }
        // 既存のスキルを更新または新規追加
        const existingSkillIndex = savedSkills.findIndex(s => s.skillName === skillName);
        if (existingSkillIndex !== -1) {
          savedSkills[existingSkillIndex].status = constantSkill.status;
        } else {
          savedSkills.push({
            skillName: skillName,
            status: constantSkill.status
          });
        }
        // JSONファイルに保存
        fs.writeFileSync(jsonPath, JSON.stringify(savedSkills, null, 2));
        if (skillName === 'auto-follow') {
          if (constantSkill.status) {
            const autoFollow =
              this.bot.constantSkills.getSkill('auto-follow');
            if (autoFollow) {
              const players = Object.values(this.bot.entities).filter(
                (entity) =>
                  entity.name === 'player' &&
                  entity.username !== this.bot.username
              );
              const nearestPlayer = players.sort(
                (a, b) =>
                  a.position.distanceTo(this.bot.entity.position) -
                  b.position.distanceTo(this.bot.entity.position)
              )[0];
              if (nearestPlayer) {
                autoFollow.run(nearestPlayer.username);
              }
            }
          } else {
            const autoFollow =
              this.bot.constantSkills.getSkill('auto-follow');
            if (autoFollow) {
              autoFollow.status = false;
            }
          }
        }
        res
          .status(200)
          .json({ success: true, result: 'constant skill status updated' });
      } catch (error) {
        res.status(500).json({ success: false, result: `error: ${error}` });
      } finally {
        await this.sendConstantSkills();
      }
    });
    this.server = this.app.listen(8082, () => {
      console.log('Express server listening on port 8082');
    });
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
          const parameters = event.data as any;
          skill.status = true;
          const response = await skill.run(...parameters);
          skill.status = false;
          this.eventBus.publish({
            type: `minebot:${skill.skillName}Result`,
            memoryZone: 'minecraft',
            data: response,
          });
        } catch (error: any) {
          this.eventBus.publish({
            type: `minebot:${skill.skillName}Result`,
            memoryZone: 'minecraft',
            data: {
              success: false,
              result: error,
            },
          });
        }
      });
    });
  }

  async registerConstantSkills() {
    this.eventBus.log('minecraft', 'blue', 'registerConstantSkills');
    // JSONファイルからstatusを読み込む
    const jsonPath = join(__dirname, '../../../saves/minecraft/constantSkills.json');
    let savedSkills: { skillName: string; status: boolean }[] = [];
    try {
      if (fs.existsSync(jsonPath)) {
        const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
        savedSkills = JSON.parse(jsonContent);
      }
    } catch (e) {
      console.error('constantSkills.json読み込みエラー:', e);
    }
    this.bot.constantSkills.getSkills().forEach((skill) => {
      // 保存されたstatusがあれば適用
      const savedSkill = savedSkills.find((s) => s.skillName === skill.skillName);
      if (savedSkill) {
        skill.status = savedSkill.status;
      }
      if (skill.interval && skill.interval > 0) {
        this.eventBus.log(
          'minecraft',
          'green',
          `✓ ${skill.skillName} ${skill.interval}ms`
        );
        this.bot.on(`taskPer${skill.interval}ms`, async () => {
          if (skill.status && !skill.isLocked) {
            try {
              await this.bot.constantSkills.requestExecution(skill, []);
            } catch (error: any) {
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
      this.bot.emit('taskPer5000ms');
    }, 5000);
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

  async sendConstantSkills() {
    try {
      const skills = this.bot.constantSkills.getSkills().map((skill) => ({
        skillName: skill.skillName,
        description: skill.description,
        status: skill.status,
      }));
      await fetch('http://localhost:8081/constant_skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(skills),
      });
    } catch (e) {
      console.error('constantSkills送信エラー:', e);
    }
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
      if (username === 'I_am_Shannon') {
        const currentTime = new Date().toLocaleString('ja-JP', {
          timeZone: 'Asia/Tokyo',
        });
        const newMessage = `${currentTime} ${username}: ${message}`;
        this.recentMessages.push(new AIMessage(newMessage));
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
            console.log(response.result);
          } else {
            console.log(`${skillName} error: ${response.result}`);
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
          `常時スキル${skillName}のステータスを${ConstantSkill.status ? 'オン' : 'オフ'
          }にしました`
        );
        await this.sendConstantSkills();
        return;
      }
      if (!message.startsWith('シャノン、')) {
        return;
      }
      const sender = this.bot.players[username]?.entity;
      this.bot.environmentState.senderName = username;
      const position = sender ? sender.position : null;
      if (position) {
        this.bot.environmentState.senderPosition = new Vec3(
          Number(position.x.toFixed(1)),
          Number(position.y.toFixed(1)),
          Number(position.z.toFixed(1))
        );
      } else {
        this.bot.environmentState.senderPosition = null;
      }
      const faceToEntity = this.bot.instantSkills.getSkill('face-to-entity');
      if (faceToEntity) {
        faceToEntity.run(username);
      }
      await this.processMessage(
        username,
        message,
        JSON.stringify(this.bot.environmentState),
        JSON.stringify(this.bot.selfState)
      );
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
    this.bot.on('entitySpawn', async (entity) => {
      const autoPickUpItem =
        this.bot.constantSkills.getSkill('auto-pick-up-item');
      if (!autoPickUpItem) {
        this.bot.chat('autoPickUpItemは存在しません');
        return;
      }
      if (!autoPickUpItem.status) return;
      try {
        autoPickUpItem.run(entity);
      } catch (error) {
        console.error('エラーが発生しました:', error);
      }
    });
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
        this.bot.chat('autoEatは存在しません');
        return;
      }
      if (!autoEat.status) return;
      try {
        await autoEat.run();
      } catch (error) {
        console.error('エラーが発生しました:', error);
      }
    });
  }

  async blockUpdate() {
    console.log(`\x1b[32m✓ blockUpdate\x1b[0m`);
    this.bot.on('blockUpdate', async (block) => {
      if (!block) return;
      const distance = this.bot.entity.position.distanceTo(block.position);
      if (distance > 4) return;
      const autoFaceUpdatedBlock = this.bot.constantSkills.getSkill(
        'auto-face-updated-block'
      );
      if (!autoFaceUpdatedBlock) {
        return;
      }
      if (!autoFaceUpdatedBlock.status) return;
      if (autoFaceUpdatedBlock.isLocked) return;
      try {
        await autoFaceUpdatedBlock.run(block);
      } catch (error) {
        console.error('エラーが発生しました:', error);
      }
    });
  }

  async entityMove() {
    console.log(`\x1b[32m✓ entityMove\x1b[0m`);
    this.bot.on('entityMoved', async (entity) => {
      const distance = this.bot.entity.position.distanceTo(entity.position);
      if (distance > 4) return;
      const autoFaceMovedEntity = this.bot.constantSkills.getSkill(
        'auto-face-moved-entity'
      );
      if (!autoFaceMovedEntity) {
        return;
      }
      if (!autoFaceMovedEntity.status) return;
      if (autoFaceMovedEntity.isLocked) return;
      try {
        await autoFaceMovedEntity.run(entity);
      } catch (error) {
        console.error('エラーが発生しました:', error);
      }
    });
  }

  async bossbar() {
    console.log(`\x1b[32m✓ bossbar\x1b[0m`);
    this.bot.on('bossBarCreated', async (bossbar) => {
      this.bot.environmentState.bossbar = JSON.stringify({
        title: bossbar.title.translate,
        health: Math.round(bossbar.health * 100),
        color: bossbar.color,
        isDragonBar: Number(bossbar.isDragonBar) === 2
      });
    });
    this.bot.on('bossBarUpdated', async (bossbar) => {
      const bossbarInfo = {
        title: bossbar.title.translate,
        health: Math.round(bossbar.health * 100),
        color: bossbar.color,
        isDragonBar: Number(bossbar.isDragonBar) === 2
      };
      this.bot.environmentState.bossbar = JSON.stringify(bossbarInfo);
    });
    this.bot.on('bossBarDeleted', async (bossbar) => {
      this.bot.environmentState.bossbar = null;
    });
  }

  private async processMessage(
    userName: string,
    message: string,
    environmentState?: string,
    selfState?: string
  ) {
    try {
      const currentTime = new Date().toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
      });
      const newMessage = `${currentTime} ${userName}: ${message}`;
      this.recentMessages.push(new HumanMessage(newMessage));
      await this.centralAgent.handlePlayerMessage(
        userName,
        message,
        environmentState,
        selfState,
        this.recentMessages
      );
    } catch (error) {
      console.error(`\x1b[31mLLM処理エラー:${error}\n\x1b[0m`);
      throw error;
    }
  }

  async startAgent() {
    try {
      const initSkillsResponse = await this.initSkills();
      if (!initSkillsResponse.success) {
        console.log(`error: ${initSkillsResponse.result}`);
        return { success: false, result: initSkillsResponse.result };
      }
      await this.botOnChat();
      await this.entitySpawn();
      await this.entityHurt();
      await this.health();
      await this.blockUpdate();
      await this.entityMove();
      await this.bossbar();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await this.setInterval();
      console.log('setInterval done');
      await this.registerPost();
      console.log('registerPost done');
      await this.centralAgent.initialize();
      console.log('centralAgent initialize done');
      await this.sendConstantSkills();
      return { success: true, result: 'agent started' };
    } catch (error) {
      console.log(`error: ${error}`);
      return { success: false, result: error };
    }
  }
}

import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { MinebotSkillInput } from '@shannon/common';
import fetch from 'node-fetch';
import { Vec3 } from 'vec3';
import { EventBus } from '../eventBus/eventBus.js';
import { CONFIG } from './config/MinebotConfig.js';
import { BotEventHandler } from './events/BotEventHandler.js';
import { MinebotHttpServer } from './http/MinebotHttpServer.js';
import { CentralAgent } from './llm/graph/centralAgent.js';
import { SkillLoader } from './skills/SkillLoader.js';
import { SkillRegistrar } from './skills/SkillRegistrar.js';
import { CustomBot } from './types.js';
import { ConstantSkillInfo, LLMError, SkillExecutionError } from './types/index.js';

/**
 * SkillAgent
 * Minecraftボットのスキル管理とイベント処理を統括するメインクラス
 * 
 * 責任:
 * - 各コンポーネントの初期化と調整
 * - チャットイベントの処理
 * - CentralAgentとの連携
 */
export class SkillAgent {
  private bot: CustomBot;
  private eventBus: EventBus;

  // コンポーネント
  private skillLoader: SkillLoader;
  private skillRegistrar: SkillRegistrar;
  private eventHandler: BotEventHandler;
  private httpServer: MinebotHttpServer;
  public centralAgent: CentralAgent;

  // 状態
  private recentMessages: BaseMessage[] = [];

  constructor(bot: CustomBot, eventBus: EventBus) {
    this.bot = bot;
    this.eventBus = eventBus;

    // コンポーネント初期化
    this.skillLoader = new SkillLoader();
    this.skillRegistrar = new SkillRegistrar(eventBus);
    this.centralAgent = CentralAgent.getInstance(this.bot);
    this.eventHandler = new BotEventHandler(this.bot, this.centralAgent, this.recentMessages);
    this.httpServer = new MinebotHttpServer(this.bot, () => this.sendConstantSkills());
  }

  /**
   * エージェントを起動
   */
  async startAgent() {
    try {
      console.log('🚀 Starting SkillAgent...');

      // スキル初期化
      const initSkillsResponse = await this.initSkills();
      if (!initSkillsResponse.success) {
        console.error(`❌ Skills initialization failed: ${initSkillsResponse.result}`);
        return { success: false, result: initSkillsResponse.result };
      }

      // チャットイベント登録
      await this.botOnChat();

      // ボットイベント登録
      this.eventHandler.registerAll();

      // 定期実行設定
      await this.setInterval();
      console.log('✅ setInterval done');

      // EventBus購読登録
      await this.registerEventBusSubscriptions();
      console.log('✅ registerEventBusSubscriptions done');

      // CentralAgent初期化
      await this.centralAgent.initialize();
      console.log('✅ centralAgent initialized');

      // 緊急イベントハンドラーを設定
      const taskCoordinator = this.centralAgent.getTaskCoordinator();
      this.eventHandler.setEmergencyHandler(taskCoordinator.getEmergencyHandler());
      console.log('✅ Emergency event handler registered');

      // HTTPサーバー起動
      this.httpServer.start();

      // UI Modにスキル情報を送信
      await this.sendConstantSkills();

      console.log('🎉 SkillAgent started successfully');
      return { success: true, result: 'agent started' };
    } catch (error) {
      console.error(`❌ SkillAgent startup failed: ${error}`);
      return { success: false, result: error };
    }
  }

  /**
   * スキルを初期化
   */
  private async initSkills() {
    console.log('🔧 Initializing skills...');

    // スキル読み込み
    const instantResult = await this.skillLoader.loadInstantSkills(this.bot);
    if (!instantResult.success || !instantResult.skills) {
      return { success: false, result: instantResult.result };
    }
    this.bot.instantSkills = instantResult.skills;

    const constantResult = await this.skillLoader.loadConstantSkills(this.bot);
    if (!constantResult.success || !constantResult.skills) {
      return { success: false, result: constantResult.result };
    }
    this.bot.constantSkills = constantResult.skills;

    // スキル登録
    this.skillRegistrar.registerInstantSkills(this.bot.instantSkills);
    this.skillRegistrar.registerConstantSkills(this.bot, this.bot.constantSkills);
    this.skillRegistrar.registerSkillControlEvents(this.bot);

    return { success: true, result: 'skills initialized' };
  }

  /**
   * チャットイベントを登録
   */
  private async botOnChat() {
    this.bot.on('chat', async (username, message) => {
      if (!this.bot.chatMode) {
        return;
      }

      // 自分の発言は記録のみ
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

      // コマンド処理
      if (await this.handleCommands(username, message)) {
        return;
      }

      // 「シャノン、」で始まるメッセージのみ処理
      if (!message.startsWith('シャノン、')) {
        return;
      }

      // 送信者情報を設定
      this.updateSenderInfo(username);

      // メッセージを処理
      await this.processMessage(
        username,
        message,
        JSON.stringify(this.bot.environmentState),
        JSON.stringify(this.bot.selfState)
      );
    });

    // EventBus経由のチャット送信
    this.eventBus.subscribe('minebot:chat', async (event) => {
      const { text } = event.data as MinebotSkillInput;
      if (text) {
        this.bot.chat(text);
      }
    });
  }

  /**
   * コマンド処理（.. ... .../ ./スキル名 ../スキル名）
   */
  private async handleCommands(username: string, message: string): Promise<boolean> {
    // .. - InstantSkill一覧表示
    if (message === '..') {
      const skill = this.bot.instantSkills.getSkill('display-instant-skill-list');
      if (skill) await skill.run();
      return true;
    }

    // ... - ConstantSkill一覧表示
    if (message === '...') {
      const skill = this.bot.instantSkills.getSkill('display-constant-skill-list');
      if (skill) await skill.run();
      return true;
    }

    // .../ - インベントリ表示
    if (message === '.../') {
      const skill = this.bot.instantSkills.getSkill('display-inventory');
      if (skill) await skill.run();
      return true;
    }

    // ./スキル名 - InstantSkill実行
    if (message.startsWith('./')) {
      const [skillName, ...args] = message.slice(2).split(' ');
      await this.executeInstantSkill(skillName);
      return true;
    }

    // ../スキル名 - ConstantSkillトグル
    if (message.startsWith('../')) {
      const skillName = message.slice(3);
      await this.toggleConstantSkill(skillName);
      return true;
    }

    return false;
  }

  /**
   * InstantSkillを実行
   */
  private async executeInstantSkill(skillName: string): Promise<void> {
    try {
      const skill = this.bot.instantSkills.getSkill(skillName);
      if (!skill) {
        this.bot.chat(`${skillName}は存在しません`);
        return;
      }

      if (skill.status) {
        this.bot.chat(`${skillName}を停止します`);
        skill.status = false;
        return;
      }

      const paramsResponse = await this.bot.utils.getParams(
        this.bot,
        skill.params as any
      );
      if (!paramsResponse.success) {
        this.bot.chat(`${skillName} error: ${paramsResponse.result}`);
        return;
      }

      skill.status = true;
      const response = await skill.run(...Object.values(paramsResponse.result));
      skill.status = false;

      console.log(`${skillName} ${response.result}`);
      if (!response.success) {
        console.log(`${skillName} error: ${response.result}`);
      }
    } catch (error) {
      const skillError = new SkillExecutionError(skillName, error as Error);
      console.error(skillError.toJSON());
      this.bot.chat(`${skillName} error: ${skillError.message}`);
    }
  }

  /**
   * ConstantSkillのオン/オフを切り替え
   */
  private async toggleConstantSkill(skillName: string): Promise<void> {
    const skill = this.bot.constantSkills.getSkill(skillName);
    if (!skill) {
      this.bot.chat(`${skillName}は存在しません`);
      return;
    }

    skill.status = !skill.status;
    this.bot.chat(
      `常時スキル${skillName}のステータスを${skill.status ? 'オン' : 'オフ'}にしました`
    );
    await this.sendConstantSkills();
  }

  /**
   * 送信者情報を更新
   */
  private updateSenderInfo(username: string): void {
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

    // 送信者の方を向く
    const faceToEntity = this.bot.instantSkills.getSkill('face-to-entity');
    if (faceToEntity) {
      faceToEntity.run(username);
    }
  }

  /**
   * メッセージを処理
   */
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
      const llmError = new LLMError('message-processing', error as Error);
      console.error(llmError.toJSON());
      this.bot.chat('エラーが発生しました。もう一度お試しください。');
    }
  }

  /**
   * 定期実行タスクを設定
   */
  private async setInterval() {
    setInterval(() => {
      this.bot.emit('taskPer100ms');
    }, CONFIG.INTERVAL_100MS);

    setInterval(() => {
      this.bot.emit('taskPer1000ms');
    }, CONFIG.INTERVAL_1000MS);

    setInterval(() => {
      this.bot.emit('taskPer5000ms');
    }, CONFIG.INTERVAL_5000MS);
  }

  /**
   * EventBus購読を登録
   */
  private async registerEventBusSubscriptions() {
    // スキル読み込みイベント
    this.eventBus.subscribe('minebot:loadSkills', async (event) => {
      try {
        const initSkillsResponse = await this.initSkills();
        this.eventBus.publish({
          type: `minebot:skillResult`,
          memoryZone: 'minecraft',
          data: {
            success: initSkillsResponse.success,
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

  /**
   * ConstantSkillsの状態をUI Modに送信
   */
  async sendConstantSkills() {
    try {
      const skills: ConstantSkillInfo[] = this.bot.constantSkills.getSkills().map((skill) => ({
        skillName: skill.skillName,
        description: skill.description,
        status: skill.status,
      }));

      await fetch(`http://localhost:${CONFIG.UI_MOD_PORT}/constant_skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(skills),
      });

      console.log('📤 Constant skills sent to UI Mod');
    } catch (error) {
      console.error('❌ Failed to send constant skills:', error);
    }
  }

  /**
   * HTTPサーバーを取得
   */
  getHttpServer(): MinebotHttpServer {
    return this.httpServer;
  }
}

import { ConversationChain } from 'langchain/chains';
import { BufferMemory } from 'langchain/memory';
import { loadPrompt } from './config/prompts.js';
import { Platform, ConversationType, LLMMessage } from './types/index.js';
import { EventBus, DiscordMessage } from '../eventBus.js';
import { RealtimeAPIService } from './realtimeApi.js';
import { AgentExecutor } from 'langchain/agents';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { TaskGraph } from './graph/taskGraph.js';

type ChainKey = `${Platform}-${ConversationType}`;

export class LLMService {
  private eventBus: EventBus;
  private chains: Map<ChainKey, AgentExecutor | ConversationChain>;
  private realtimeApi: RealtimeAPIService;
  private taskGraph;
  private systemPrompts: Map<string, string>;
  private conversationHistories: Map<string, BaseMessage[]>;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.chains = new Map();
    this.realtimeApi = new RealtimeAPIService(eventBus);
    this.taskGraph = new TaskGraph(eventBus);
    this.systemPrompts = new Map();
    this.conversationHistories = new Map();
    this.setupEventBus();
    this.setupRealtimeAPICallback();
    this.setupSystemPrompts();
  }

  private async setupSystemPrompts() {
    for (const platform of ['discord', 'web']) {
      for (const type of ['text', 'voice']) {
        const prompt = await loadPrompt(
          platform as Platform,
          type as ConversationType
        );
        if (prompt) {
          this.systemPrompts.set(`${platform}-${type}`, prompt);
        }
      }
    }
  }

  private setupEventBus() {
    this.eventBus.subscribe('web:message', (event) => {
      this.processWebMessage(event.data);
    });

    this.eventBus.subscribe('discord:message', (event) => {
      this.processDiscordMessage(event.data as DiscordMessage);
    });
  }

  async processWebMessage(message: LLMMessage) {
    try {
      if (message.type === 'realtime_text') {
        await this.realtimeApi.inputText(message.content);
        return;
      } else if (message.type === 'realtime_voice_append') {
        await this.realtimeApi.inputAudioBufferAppend(message.content);
        return;
      } else if (message.type === 'realtime_voice_commit') {
        await this.realtimeApi.inputAudioBufferCommit();
        return;
      } else if (message.type === 'realtime_vad_change') {
        await this.realtimeApi.vadModeChange(message.content);
        return;
      } else if (message.type === 'text') {
        const prompt = this.systemPrompts.get(`web-text`);
        if (!prompt) {
          throw new Error('System prompt not found');
        }
        const response = await this.processMessage(
          'User',
          message.content,
          'web',
          'web',
          '',
          prompt
        );
        this.eventBus.log('web', 'green', response, true);
        this.eventBus.publish({
          type: 'llm:response',
          platform: 'web',
          data: {
            content: response,
            type: 'text',
            context: {},
          },
        });
        return;
      }
    } catch (error) {
      console.error('LLM処理エラー:', error);
    }
  }

  async processDiscordMessage(message: DiscordMessage) {
    try {
      // システムプロンプトの取得
      const prompt = this.systemPrompts.get(`discord-text`);
      if (!prompt) {
        throw new Error('System prompt not found');
      }

      const info = {
        guildName: message.guildName,
        channelName: message.channelName,
        channelId: message.channelId,
        messageId: message.messageId,
        userId: message.userId,
      };

      const infoMessage = JSON.stringify(info);

      const response = await this.processMessage(
        message.userName,
        message.content,
        'discord',
        message.channelId,
        infoMessage,
        prompt
      );

      this.eventBus.publish({
        type: 'llm:response',
        platform: 'discord',
        data: {
          content: response,
          type: 'text',
          channelId: message.channelId,
          userName: message.userName,
        },
      });
    } catch (error) {
      console.error('LLM処理エラー:', error);
      this.eventBus.log('discord', 'red', `Error: ${error}`, true);
      throw error;
    }
  }

  private async processMessage(
    userName: string,
    message: string,
    platform: Platform,
    platformId: string,
    infoMessage: string,
    prompt: string
  ) {
    try {
      const newMessage = new HumanMessage(`${userName}: ${message}`);

      this.saveConversationHistory(platformId, [
        ...this.getConversationHistory(platformId),
        newMessage,
      ]);

      // グラフを実行
      const result = await this.taskGraph.invoke({
        platform: platform,
        systemPrompt: prompt,
        infoMessage: infoMessage,
        messages: [],
        taskTree: {
          goal: '',
          plan: '',
          status: 'pending',
          subTasks: [],
        },
        conversationHistory: {
          messages: this.getConversationHistory(platformId) || [],
        },
        decision: '',
      });

      // 結果の取得と送信
      const lastMessage = result.messages[result.messages.length - 1];

      this.saveConversationHistory(platformId, [
        ...this.getConversationHistory(platformId),
        new AIMessage(lastMessage.content.toString()),
      ]);
      // エラー発生時のログ
      if (result.taskTree.status === 'error') {
        console.error('Task error:', result.taskTree.error);
        this.eventBus.log(
          'discord',
          'red',
          `Error: ${result.taskTree.error}`,
          true
        );
      }
      return lastMessage.content.toString();
    } catch (error) {
      console.error('LLM処理エラー:', error);
      this.eventBus.log('discord', 'red', `Error: ${error}`, true);
      throw error;
    }
  }

  private setupRealtimeAPICallback() {
    this.realtimeApi.setTextCallback((text) => {
      this.eventBus.publish({
        type: 'llm:response',
        platform: 'web',
        data: {
          content: text,
          type: 'text',
          context: {},
        },
      });
    });

    this.realtimeApi.setTextDoneCallback(() => {
      this.eventBus.publish({
        type: 'llm:response',
        platform: 'web',
        data: {
          content: '',
          type: 'text_done',
          context: {},
        },
      });
    });

    this.realtimeApi.setAudioCallback((audio) => {
      this.eventBus.publish({
        type: 'llm:response',
        platform: 'web',
        data: {
          content: audio,
          type: 'audio',
          context: {},
        },
      });
    });

    this.realtimeApi.setAudioDoneCallback(() => {
      this.eventBus.publish({
        type: 'llm:response',
        platform: 'web',
        data: {
          content: '',
          type: 'audio_done',
          context: {},
        },
      });
    });

    this.realtimeApi.setUserTranscriptCallback((text) => {
      this.eventBus.publish({
        type: 'llm:response',
        platform: 'web',
        data: {
          content: text,
          type: 'user_transcript',
          context: {},
        },
      });
    });
  }

  resetContext(platform: Platform) {
    this.chains.forEach((chain, key) => {
      if (key.startsWith(platform)) {
        if (chain?.memory) {
          (chain.memory as BufferMemory).clear();
        }
      }
    });
  }

  resetAllContexts() {
    this.chains.forEach((chain) => {
      if (chain?.memory) {
        (chain.memory as BufferMemory).clear();
      }
    });
  }

  public async initialize() {
    try {
      console.log('\x1b[36mLLM Service initialized\x1b[0m');
    } catch (error) {
      console.error('LLM initialization error:', error);
      throw error;
    }
  }

  private getConversationHistory(channelId: string): BaseMessage[] {
    return this.conversationHistories.get(channelId) || [];
  }

  private saveConversationHistory(channelId: string, messages: BaseMessage[]) {
    if (messages.length > 50) {
      messages = messages.slice(Math.max(messages.length - 50, 0));
    }
    this.conversationHistories.set(channelId, messages);
  }
}

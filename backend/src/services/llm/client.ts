import { ConversationChain } from 'langchain/chains';
import { BufferMemory } from 'langchain/memory';
import { loadPrompt } from './config/prompts.js';
import { Platform, ConversationType, LLMMessage } from './types/index.js';
import { EventBus, DiscordMessage } from '../eventBus.js';
import { RealtimeAPIService } from './realtimeApi.js';
import { AgentExecutor } from 'langchain/agents';
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { createTaskGraph } from './graph/taskGraph.js';

type ChainKey = `${Platform}-${ConversationType}`;

export class LLMService {
  private eventBus: EventBus;
  private chains: Map<ChainKey, AgentExecutor | ConversationChain>;
  private realtimeApi: RealtimeAPIService;
  private taskGraph;
  private systemPrompts: Map<string, string>;
  private conversationHistories: Map<string, BaseMessage[]>;
  private conversationSummaries: Map<string, string>;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.chains = new Map();
    this.realtimeApi = new RealtimeAPIService(eventBus);
    this.taskGraph = createTaskGraph();
    this.systemPrompts = new Map();
    this.conversationHistories = new Map();
    this.conversationSummaries = new Map();
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

      const newMessage = new HumanMessage(
        `${message.userName}: ${message.content}`
      );

      this.saveConversationHistory(message.channelId, [
        ...this.getConversationHistory(message.channelId),
        newMessage,
      ]);

      const info = {
        guildName: message.guildName,
        channelName: message.channelName,
        channelId: message.channelId,
        messageId: message.messageId,
        userId: message.userId,
      };

      const infoMessage = JSON.stringify(info);

      // グラフを実行
      const result = await this.taskGraph.invoke({
        systemPrompt: prompt,
        infoMessage: infoMessage,
        messages: [],
        taskTree: {
          goal: message.content,
          status: 'pending',
          children: [],
        },
        conversationHistory: {
          messages: this.getConversationHistory(message.channelId) || [],
        },
      });

      // 結果の取得と送信
      const lastMessage = result.messages[result.messages.length - 1];

      this.saveConversationHistory(message.channelId, [
        ...this.getConversationHistory(message.channelId),
        new AIMessage(lastMessage.content.toString()),
      ]);

      this.eventBus.publish({
        type: 'llm:response',
        platform: 'discord',
        data: {
          content: lastMessage.content.toString(),
          type: 'text',
          channelId: message.channelId,
          userName: message.userName,
        } as DiscordMessage,
      });

      // エラー発生時のログ
      if (result.taskTree.status === 'error') {
        console.error('Task error:', result.taskTree.error);
        this.eventBus.log('discord', 'red', `Error: ${result.taskTree.error}`);
      }
    } catch (error) {
      console.error('LLM処理エラー:', error);
      this.eventBus.log('discord', 'red', `Error: ${error}`);
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
      console.log('LLM Service initialized');
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

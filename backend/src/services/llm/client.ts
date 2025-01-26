import { ChatOpenAI } from '@langchain/openai';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
  SystemMessagePromptTemplate,
  HumanMessagePromptTemplate,
} from '@langchain/core/prompts';
import { ConversationChain } from 'langchain/chains';
import {
  BufferMemory,
  ConversationSummaryBufferMemory,
} from 'langchain/memory';
import { loadPrompt } from './config/prompts.js';
import { Platform, ConversationType, LLMMessage } from './types/index.js';
import { EventBus, DiscordMessage } from '../eventBus.js';
import { RealtimeAPIService } from './realtimeApi.js';

type ChainKey = `${Platform}-${ConversationType}`;

export class LLMService {
  private eventBus: EventBus;
  private chains: Map<ChainKey, ConversationChain>;
  private realtimeApi: RealtimeAPIService;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.chains = new Map();
    this.realtimeApi = new RealtimeAPIService(eventBus);
    this.initializeChains();
    this.setupEventBus();
    this.setupRealtimeAPICallback();
  }

  private async initializeChains() {
    const platforms: Platform[] = ['web', 'discord', 'minecraft'];
    const types: ConversationType[] = ['text', 'voice'];
    for (const platform of platforms) {
      for (const type of types) {
        await this.initializeChain(platform, type);
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
    const chainKey = `discord-${message.type}` as ChainKey;
    const chain = this.chains.get(chainKey);

    if (!chain) {
      throw new Error(`Chain not found for ${chainKey}`);
    }

    const response = await chain.call({
      input: message.userName + ': ' + message.content,
    });

    this.eventBus.publish({
      type: 'llm:response',
      platform: 'discord',
      data: {
        content: response.response,
        type: 'text',
        channelId: message.channelId,
        userName: message.userName,
      } as DiscordMessage,
    });
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

  private async initializeChain(platform: Platform, type: ConversationType) {
    const prompt = await loadPrompt(platform, type);

    const model = new ChatOpenAI({
      modelName: 'gpt-4o',
      temperature: 0.8,
    });

    const chatPrompt = ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(prompt),
      new MessagesPlaceholder('history'),
      HumanMessagePromptTemplate.fromTemplate('{input}'),
    ]);

    const summaryLLM = new ChatOpenAI({
      modelName: 'gpt-3.5-turbo',
      temperature: 0,
    });

    const memory = new ConversationSummaryBufferMemory({
      llm: summaryLLM,
      maxTokenLimit: 1000,
      returnMessages: true,
      memoryKey: 'history',
      inputKey: 'input',
      outputKey: 'response',
      humanPrefix: 'Human',
      aiPrefix: 'Assistant',
    });

    const chain = new ConversationChain({
      memory: memory,
      prompt: chatPrompt,
      llm: model,
      verbose: true,
    });

    const chainKey = `${platform}-${type}` as ChainKey;
    this.chains.set(chainKey, chain);
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
      // LLMの初期化処理（例：API接続テストなど）
      console.log('LLM Service initialized');
    } catch (error) {
      console.error('LLM initialization error:', error);
      throw error;
    }
  }
}

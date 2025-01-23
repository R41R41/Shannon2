import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { BaseMessage } from '@langchain/core/messages';
import { ConversationChain } from 'langchain/chains';
import { BufferMemory } from 'langchain/memory';
import { loadPrompt } from './config/prompts.js';
import { Platform, ConversationType, LLMMessage, LLMResponse } from './types/index.js';
import { EventBus } from './eventBus.js';

type ChainKey = `${Platform}-${ConversationType}`;

export class LLMService {
  private eventBus: EventBus;
  private chains: Map<ChainKey, ConversationChain>;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.chains = new Map();
    this.initializeChains();
  }

  private async initializeChains() {
    const platforms: Platform[] = ["web","discord","minecraft"];
    const types: ConversationType[] = ['text', 'voice'];

    for (const platform of platforms) {
      for (const type of types) {
        await this.initializeChain(platform, type);
      }
    }
  }

  private async initializeChain(platform: Platform, type: ConversationType) {
    const prompt = await loadPrompt(platform, type);
    
    const model = new ChatOpenAI({
      modelName: 'gpt-4o',
      temperature: 0.8,
    });

    const chain = new ConversationChain({
      llm: model,
      memory: new BufferMemory(),
      prompt: ChatPromptTemplate.fromMessages([
        ['system', prompt],
        ['human', '{input}']
      ])
    });

    const chainKey = `${platform}-${type}` as ChainKey;
    this.chains.set(chainKey, chain);
  }

  async processMessage(message: LLMMessage) {
    try {
      const chainKey = `${message.platform}-${message.type}` as ChainKey;
      const chain = this.chains.get(chainKey);
      
      if (!chain) {
        throw new Error(`Chain not found for ${chainKey}`);
      }

      const response = await chain.call({
        input: message.content
      });

      this.eventBus.publish({
        type: 'llm:response',
        platform: message.platform,
        data: {
          content: response.response,
          type: message.type,
          context: message.context
        }
      });
    } catch (error) {
      console.error('LLM処理エラー:', error);
    }
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
    this.chains.forEach((chain, key) => {
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
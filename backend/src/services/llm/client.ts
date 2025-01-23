import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { BaseMessage } from '@langchain/core/messages';
import { ConversationChain } from 'langchain/chains';
import { BufferMemory } from 'langchain/memory';
import { loadPrompt } from './config/prompts.js';
import { Platform, LLMResponse } from './types/index.js';

export class LLMService {
  private model: ChatOpenAI;
  private chains: Map<Platform, ConversationChain>;

  constructor() {
    this.model = new ChatOpenAI({
      modelName: 'gpt-4-turbo-preview',
      temperature: 0.7,
      maxTokens: 500,
    });
    
    this.chains = new Map();
    ['twitter', 'discord', 'youtube', 'minecraft'].forEach(platform => {
      this.initializeChain(platform as Platform);
    });
  }

  private async initializeChain(platform: Platform) {
    const basePrompt = await loadPrompt('base');
    const platformPrompt = await loadPrompt(platform);
    
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', basePrompt],
      ['system', platformPrompt],
      ['human', '{input}'],
      ['ai', '{response}']
    ]);

    const memory = new BufferMemory({
      returnMessages: true,
      memoryKey: 'history',
      inputKey: 'input',
      outputKey: 'response'
    });

    const chain = new ConversationChain({
      llm: this.model,
      prompt,
      memory,
      verbose: process.env.NODE_ENV === 'development'
    });

    this.chains.set(platform, chain);
  }

  async chat(message: string, platform: Platform): Promise<LLMResponse> {
    try {
      const chain = this.chains.get(platform);
      if (!chain) {
        throw new Error(`${platform}用のチェーンが初期化されていません`);
      }

      const response = await chain.call({
        input: message
      });

      return {
        content: response.response
      };
    } catch (error) {
      console.error('LLM Error:', error);
      return {
        content: '',
        error: error instanceof Error ? error.message : 'LLMサービスでエラーが発生しました'
      };
    }
  }

  resetContext(platform: Platform) {
    const chain = this.chains.get(platform);
    if (chain?.memory) {
      (chain.memory as BufferMemory).clear();
    }
  }

  resetAllContexts() {
    this.chains.forEach(chain => {
      if (chain?.memory) {
        (chain.memory as BufferMemory).clear();
      }
    });
  }
} 
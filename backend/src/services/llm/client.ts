import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { isDiscordMessageInput } from '../../types/checkTypes.js';
import {
  DiscordMessageInput,
  DiscordMessageOutput,
  MemoryZone,
  OpenAIMessageInput,
  OpenAIMessageOutput,
  PromptType,
  promptTypes,
  TwitterMessageInput,
  TwitterMessageOutput,
} from '../../types/types.js';
import { getDiscordMemoryZone } from '../../utils/discord.js';
import { EventBus } from '../eventBus.js';
import { PostAboutTodayAgent } from './agents/postAboutTodayAgent.js';
import { PostFortuneAgent } from './agents/postFortuneAgent.js';
import { PostWeatherAgent } from './agents/postWeatherAgent.js';
import { RealtimeAPIService } from './agents/realtimeApiAgent.js';
import { loadPrompt } from './config/prompts.js';
import { TaskGraph } from './graph/taskGraph.js';

export class LLMService {
  private eventBus: EventBus;
  private realtimeApi: RealtimeAPIService;
  private taskGraph: TaskGraph;
  private systemPrompts: Map<PromptType, string>;
  private conversationHistories: Map<MemoryZone, BaseMessage[]>;
  private aboutTodayAgent: PostAboutTodayAgent;
  private weatherAgent: PostWeatherAgent;
  private fortuneAgent: PostFortuneAgent;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.realtimeApi = new RealtimeAPIService(eventBus);
    this.taskGraph = new TaskGraph(eventBus);
    this.systemPrompts = new Map();
    this.conversationHistories = new Map();
    this.setupEventBus();
    this.setupRealtimeAPICallback();
    this.setupSystemPrompts();
    this.aboutTodayAgent = new PostAboutTodayAgent();
    this.weatherAgent = new PostWeatherAgent();
    this.fortuneAgent = new PostFortuneAgent();
  }

  private async setupSystemPrompts() {
    for (const promptType of promptTypes) {
      const prompt = await loadPrompt(promptType);
      if (prompt) {
        this.systemPrompts.set(promptType, prompt);
      }
    }
  }

  private setupEventBus() {
    this.eventBus.subscribe('web:get_message', (event) => {
      this.processWebMessage(event.data as OpenAIMessageInput);
    });

    this.eventBus.subscribe('discord:get_message', (event) => {
      this.processDiscordMessage(event.data as DiscordMessageInput);
    });

    this.eventBus.subscribe('twitter:post_scheduled_message', (event) => {
      this.processCreatePost(event.data as TwitterMessageInput);
    });
  }

  private async processWebMessage(message: OpenAIMessageInput) {
    try {
      if (message.type === 'realtime_text') {
        if (message.realtime_text) {
          await this.realtimeApi.inputText(message.realtime_text);
        }
        return;
      } else if (
        message.type === 'realtime_audio' &&
        message.endpoint === 'realtime_audio_append'
      ) {
        if (message.realtime_audio) {
          await this.realtimeApi.inputAudioBufferAppend(message.realtime_audio);
        }
        return;
      } else if (
        message.type === 'realtime_audio' &&
        message.endpoint === 'realtime_audio_commit'
      ) {
        await this.realtimeApi.inputAudioBufferCommit();
        return;
      } else if (message.endpoint === 'realtime_vad_on') {
        await this.realtimeApi.vadModeChange(true);
        return;
      } else if (message.endpoint === 'realtime_vad_off') {
        await this.realtimeApi.vadModeChange(false);
        return;
      } else if (message.type === 'text') {
        const response = await this.processMessage(
          ['base_text'],
          'web',
          ['web'],
          null,
          message.text,
          null
        );
        this.eventBus.log('web', 'green', response, true);
        this.eventBus.publish({
          type: 'web:post_message',
          memoryZone: 'web',
          data: {
            text: response,
            type: 'text',
          } as OpenAIMessageOutput,
          targetMemoryZones: ['web'],
        });
        return;
      }
    } catch (error) {
      console.error('LLM処理エラー:', error);
    }
  }

  private async processDiscordMessage(message: DiscordMessageInput) {
    try {
      if (!isDiscordMessageInput(message)) {
        console.error(
          `Invalid discord message input: ${JSON.stringify(message)}`
        );
        return;
      }
      if (
        message.type === 'realtime_audio' &&
        message.endpoint === 'realtime_audio_append'
      ) {
        if (message.realtime_audio) {
          await this.realtimeApi.inputAudioBufferAppend(message.realtime_audio);
        }
        return;
      } else if (
        message.type === 'realtime_audio' &&
        message.endpoint === 'realtime_audio_commit'
      ) {
        await this.realtimeApi.inputAudioBufferCommit();
        return;
      } else if (message.endpoint === 'realtime_vad_on') {
        await this.realtimeApi.vadModeChange(true);
        return;
      } else if (message.endpoint === 'realtime_vad_off') {
        await this.realtimeApi.vadModeChange(false);
        return;
      } else if (message.type === 'text') {
        const info = {
          guildName: message.guildName,
          channelName: message.channelName,
          guildId: message.guildId,
          channelId: message.channelId,
          messageId: message.messageId,
          userId: message.userId,
        };
        const infoMessage = JSON.stringify(info);
        const memoryZone = getDiscordMemoryZone(message.guildId);

        const response = await this.processMessage(
          ['base_text', 'discord'],
          memoryZone,
          [memoryZone],
          message.userName,
          message.text,
          infoMessage
        );
        this.eventBus.log(memoryZone, 'green', response, true);
        this.eventBus.publish({
          type: 'discord:post_message',
          memoryZone: memoryZone,
          data: {
            text: response,
            type: 'text',
            channelId: message.channelId,
            guildId: message.guildId,
          } as DiscordMessageOutput,
          targetMemoryZones: [memoryZone],
        });
        return;
      }
    } catch (error) {
      console.error('LLM処理エラー:', error);
      throw error;
    }
  }

  private async processCreatePost(message: TwitterMessageInput) {
    let post = '';
    let postForToyama = '';
    if (message.endpoint === 'forecast') {
      post = await this.weatherAgent.createPost();
      postForToyama = await this.weatherAgent.createPostForToyama();
    } else if (message.endpoint === 'fortune') {
      post = await this.fortuneAgent.createPost();
      postForToyama = post;
    } else if (message.endpoint === 'about_today') {
      post = await this.aboutTodayAgent.createPost();
      postForToyama = post;
    }

    this.saveConversationHistory('twitter:schedule_post', [
      ...this.getConversationHistory('twitter:schedule_post'),
      new AIMessage(post),
    ]);
    this.saveConversationHistory('discord:toyama_server', [
      ...this.getConversationHistory('discord:toyama_server'),
      new AIMessage(postForToyama),
    ]);
    this.eventBus.log('twitter:schedule_post', 'green', post, true);
    this.eventBus.publish({
      type: 'twitter:post_scheduled_message',
      memoryZone: 'twitter:schedule_post',
      data: {
        endpoint: message.endpoint,
        text: post,
      } as TwitterMessageOutput,
      targetMemoryZones: ['twitter:schedule_post', 'discord:aiminelab_server'],
    });
    this.eventBus.publish({
      type: 'discord:post_message',
      memoryZone: 'discord:toyama_server',
      data: {
        endpoint: message.endpoint,
        text: postForToyama,
      } as TwitterMessageOutput,
      targetMemoryZones: ['discord:toyama_server'],
    });
  }

  /**
   * メッセージを処理する
   * @param promptType プロンプトタイプ
   * @param platform プラットフォーム
   * @param userName ユーザー名
   * @param message メッセージ
   * @param infoMessage 追加情報
   * @param inputMemoryZone 入力メモリゾーン
   * @param outputMemoryZones 出力メモリゾーン
   * @returns 応答メッセージ
   */
  private async processMessage(
    promptTypes: PromptType[],
    inputMemoryZone: MemoryZone,
    outputMemoryZones?: MemoryZone[] | null,
    userName?: string | null,
    message?: string | null,
    infoMessage?: string | null
  ): Promise<string> {
    try {
      const prompts = promptTypes.map((promptType) =>
        this.systemPrompts.get(promptType)
      );
      const prompt = prompts.join('\n');

      const newMessage = new HumanMessage(`${userName}: ${message}`);

      this.saveConversationHistory(inputMemoryZone, [
        ...this.getConversationHistory(inputMemoryZone),
        newMessage,
      ]);
      const messages = inputMemoryZone
        ? this.getConversationHistory(inputMemoryZone)
        : [];

      const result = await this.taskGraph.invoke({
        memoryZone: inputMemoryZone,
        systemPrompt: prompt,
        infoMessage: infoMessage || null,
        messages: messages,
        taskTree: {
          goal: '',
          plan: '',
          status: 'pending',
          subTasks: [],
        },
        conversationHistory: {
          messages: messages,
        },
        decision: '',
      });

      console.log(result);

      const lastMessage = result.messages[result.messages.length - 1];

      if (outputMemoryZones) {
        outputMemoryZones.forEach((memoryZone) => {
          this.saveConversationHistory(memoryZone, [
            ...this.getConversationHistory(memoryZone),
            new AIMessage(lastMessage.content.toString()),
          ]);
        });
      } else {
        this.saveConversationHistory(inputMemoryZone, [
          ...this.getConversationHistory(inputMemoryZone),
          new AIMessage(lastMessage.content.toString()),
        ]);
      }
      return lastMessage.content.toString();
    } catch (error) {
      console.error(`\x1b[31mLLM処理エラー:${error}\n\x1b[0m`);
      this.eventBus.log(inputMemoryZone, 'red', `Error: ${error}`, true);
      throw error;
    }
  }

  private setupRealtimeAPICallback() {
    this.realtimeApi.setTextCallback((text) => {
      this.eventBus.publish({
        type: 'web:post_message',
        memoryZone: 'web',
        data: {
          type: 'realtime_text',
          realtime_text: text,
        } as OpenAIMessageOutput,
        targetMemoryZones: ['web'],
      });
    });

    this.realtimeApi.setTextDoneCallback(() => {
      this.eventBus.publish({
        type: 'web:post_message',
        memoryZone: 'web',
        data: {
          type: 'realtime_text',
          endpoint: 'text_done',
        } as OpenAIMessageOutput,
        targetMemoryZones: ['web'],
      });
    });

    this.realtimeApi.setAudioCallback((audio) => {
      this.eventBus.publish({
        type: 'web:post_message',
        memoryZone: 'web',
        data: {
          realtime_audio: audio.toString(),
          type: 'realtime_audio',
          endpoint: 'realtime_audio_append',
        } as OpenAIMessageOutput,
        targetMemoryZones: ['web'],
      });
    });

    this.realtimeApi.setAudioDoneCallback(() => {
      this.eventBus.publish({
        type: 'web:post_message',
        memoryZone: 'web',
        data: {
          type: 'realtime_audio',
          endpoint: 'realtime_audio_commit',
        } as OpenAIMessageOutput,
        targetMemoryZones: ['web'],
      });
    });

    this.realtimeApi.setUserTranscriptCallback((text) => {
      this.eventBus.publish({
        type: 'web:post_message',
        memoryZone: 'web',
        data: {
          realtime_text: text,
          type: 'user_transcript',
        } as OpenAIMessageOutput,
        targetMemoryZones: ['web'],
      });
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

  private getConversationHistory(memoryZone: MemoryZone): BaseMessage[] {
    return this.conversationHistories.get(memoryZone) || [];
  }

  private saveConversationHistory(
    memoryZone: MemoryZone,
    messages: BaseMessage[]
  ) {
    if (messages.length > 50) {
      messages = messages.slice(Math.max(messages.length - 50, 0));
    }
    this.conversationHistories.set(memoryZone, messages);
  }
}

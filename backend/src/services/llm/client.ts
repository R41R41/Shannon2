import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import {
  DiscordClientInput,
  DiscordClientOutput,
  isDiscordClientInput,
  MemoryZone,
  OpenAIMessageInput,
  OpenAIMessageOutput,
  PromptType,
  promptTypes,
  TwitterClientInput,
  TwitterClientOutput,
  YoutubeClientInput,
  YoutubeClientOutput,
} from '@shannon/common';
import { getDiscordMemoryZone } from '../../utils/discord.js';
import { EventBus } from '../eventBus.js';
import { PostAboutTodayAgent } from './agents/postAboutTodayAgent.js';
import { PostFortuneAgent } from './agents/postFortuneAgent.js';
import { PostWeatherAgent } from './agents/postWeatherAgent.js';
import { RealtimeAPIService } from './agents/realtimeApiAgent.js';
import { ReplyTwitterCommentAgent } from './agents/replyTwitterComment.js';
import { ReplyYoutubeCommentAgent } from './agents/replyYoutubeComment.js';
import { loadPrompt } from './config/prompts.js';
import { TaskGraph } from './graph/taskGraph.js';

export class LLMService {
  private eventBus: EventBus;
  private realtimeApi: RealtimeAPIService;
  private taskGraph: TaskGraph;
  private systemPrompts: Map<PromptType, string>;
  private conversationHistories: Map<MemoryZone, BaseMessage[]>;
  private aboutTodayAgent!: PostAboutTodayAgent;
  private weatherAgent!: PostWeatherAgent;
  private fortuneAgent!: PostFortuneAgent;
  private replyTwitterCommentAgent!: ReplyTwitterCommentAgent;
  private replyYoutubeCommentAgent!: ReplyYoutubeCommentAgent;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.realtimeApi = new RealtimeAPIService(eventBus);
    this.taskGraph = new TaskGraph(eventBus);
    this.systemPrompts = new Map();
    this.conversationHistories = new Map();
    this.setupEventBus();
    this.setupRealtimeAPICallback();
  }

  public async initialize() {
    await this.setupSystemPrompts();
    this.aboutTodayAgent = await PostAboutTodayAgent.create();
    this.weatherAgent = await PostWeatherAgent.create();
    this.fortuneAgent = await PostFortuneAgent.create();
    this.replyTwitterCommentAgent = await ReplyTwitterCommentAgent.create();
    this.replyYoutubeCommentAgent = await ReplyYoutubeCommentAgent.create();
    console.log('\x1b[36mLLM Service initialized\x1b[0m');
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
    this.eventBus.subscribe('llm:get_web_message', (event) => {
      this.processWebMessage(event.data as OpenAIMessageInput);
    });

    this.eventBus.subscribe('llm:get_discord_message', (event) => {
      this.processDiscordMessage(event.data as DiscordClientInput);
    });

    this.eventBus.subscribe('llm:post_scheduled_message', (event) => {
      this.processCreateScheduledPost(event.data as TwitterClientInput);
    });

    this.eventBus.subscribe('llm:post_twitter_reply', (event) => {
      this.processTwitterReply(event.data as TwitterClientOutput);
    });

    this.eventBus.subscribe('llm:reply_youtube_comment', (event) => {
      this.processYoutubeReply(event.data as YoutubeClientOutput);
    });
  }

  private async processYoutubeReply(data: YoutubeClientOutput) {
    const comment = data.text;
    const videoTitle = data.videoTitle;
    const videoDescription = data.videoDescription;
    const authorName = data.authorName;
    const reply = await this.replyYoutubeCommentAgent.reply(
      comment,
      videoTitle,
      videoDescription,
      authorName
    );
    this.eventBus.publish({
      type: 'youtube:reply_comment',
      memoryZone: 'youtube',
      data: {
        videoId: data.videoId,
        commentId: data.commentId,
        reply,
      } as YoutubeClientInput,
    });
  }

  private async processTwitterReply(data: TwitterClientOutput) {
    const text = data.text;
    const replyId = data.replyId;
    const authorName = data.authorName;
    const myTweet = data.myTweet;

    if (!text || !replyId || !authorName || !myTweet) {
      console.error('Twitter reply data is invalid');
      return;
    }

    const response = await this.replyTwitterCommentAgent.reply(
      text,
      authorName,
      myTweet
    );
    this.eventBus.publish({
      type: 'twitter:post_message',
      memoryZone: 'twitter:post',
      data: {
        text: response,
        replyId: replyId,
      } as TwitterClientInput,
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
        message.command === 'realtime_audio_append'
      ) {
        if (message.realtime_audio) {
          await this.realtimeApi.inputAudioBufferAppend(message.realtime_audio);
        }
        return;
      } else if (
        message.type === 'realtime_audio' &&
        message.command === 'realtime_audio_commit'
      ) {
        await this.realtimeApi.inputAudioBufferCommit();
        return;
      } else if (message.command === 'realtime_vad_on') {
        await this.realtimeApi.vadModeChange(true);
        return;
      } else if (message.command === 'realtime_vad_off') {
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
        if (response === '') {
          return;
        }
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

  private async processDiscordMessage(message: DiscordClientInput) {
    try {
      if (!isDiscordClientInput(message)) {
        console.error(
          `Invalid discord message input: ${JSON.stringify(message)}`
        );
        return;
      }
      if (
        message.type === 'realtime_audio' &&
        message.command === 'realtime_audio_append'
      ) {
        if (message.realtime_audio) {
          await this.realtimeApi.inputAudioBufferAppend(message.realtime_audio);
        }
        return;
      } else if (
        message.type === 'realtime_audio' &&
        message.command === 'realtime_audio_commit'
      ) {
        await this.realtimeApi.inputAudioBufferCommit();
        return;
      } else if (message.command === 'realtime_vad_on') {
        await this.realtimeApi.vadModeChange(true);
        return;
      } else if (message.command === 'realtime_vad_off') {
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
          recentMessages: message.recentMessages,
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
        if (response === '') {
          return;
        }
        this.eventBus.log(memoryZone, 'green', response, true);
        this.eventBus.publish({
          type: 'discord:post_message',
          memoryZone: memoryZone,
          data: {
            text: response,
            type: 'text',
            channelId: message.channelId,
            guildId: message.guildId,
          } as DiscordClientOutput,
          targetMemoryZones: [memoryZone],
        });
        return;
      }
    } catch (error) {
      console.error('LLM処理エラー:', error);
      throw error;
    }
  }

  private async processCreateScheduledPost(message: TwitterClientInput) {
    let post = '';
    let postForToyama = '';
    if (message.command === 'forecast') {
      post = await this.weatherAgent.createPost();
      postForToyama = await this.weatherAgent.createPostForToyama();
    } else if (message.command === 'fortune') {
      post = await this.fortuneAgent.createPost();
      postForToyama = post;
    } else if (message.command === 'about_today') {
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
        command: message.command,
        text: post,
      } as TwitterClientInput,
      targetMemoryZones: ['twitter:schedule_post'],
    });
    this.eventBus.publish({
      type: 'discord:post_message',
      memoryZone: 'discord:toyama_server',
      data: {
        command: message.command,
        text: postForToyama,
      } as DiscordClientOutput,
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

      const aiMessages = result.messages.filter(
        (message: BaseMessage): message is AIMessage =>
          message instanceof AIMessage
      );
      const lastMessage = aiMessages[aiMessages.length - 1];

      if (result.decision === 'ignore') {
        return '';
      }

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
          command: 'text_done',
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
          command: 'realtime_audio_append',
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
          command: 'realtime_audio_commit',
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

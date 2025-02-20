import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import {
  DiscordSendTextMessageOutput,
  DiscordScheduledPostInput,
  MemoryZone,
  OpenAIMessageOutput,
  OpenAIRealTimeTextInput,
  OpenAIRealTimeAudioInput,
  OpenAICommandInput,
  OpenAITextInput,
  TwitterClientInput,
  TwitterClientOutput,
  YoutubeClientInput,
  YoutubeClientOutput,
} from '@shannon/common';
import { getDiscordMemoryZone } from '../../utils/discord.js';
import { EventBus } from '../eventBus/eventBus.js';
import { PostAboutTodayAgent } from './agents/postAboutTodayAgent.js';
import { PostFortuneAgent } from './agents/postFortuneAgent.js';
import { PostWeatherAgent } from './agents/postWeatherAgent.js';
import { RealtimeAPIService } from './agents/realtimeApiAgent.js';
import { ReplyTwitterCommentAgent } from './agents/replyTwitterComment.js';
import { ReplyYoutubeCommentAgent } from './agents/replyYoutubeComment.js';
import { TaskGraph } from './graph/taskGraph.js';
import { getEventBus } from '../eventBus/index.js';

export class LLMService {
  private eventBus: EventBus;
  private realtimeApi: RealtimeAPIService;
  private taskGraph: TaskGraph;
  private aboutTodayAgent!: PostAboutTodayAgent;
  private weatherAgent!: PostWeatherAgent;
  private fortuneAgent!: PostFortuneAgent;
  private replyTwitterCommentAgent!: ReplyTwitterCommentAgent;
  private replyYoutubeCommentAgent!: ReplyYoutubeCommentAgent;

  constructor() {
    this.eventBus = getEventBus();
    this.realtimeApi = new RealtimeAPIService();
    this.taskGraph = new TaskGraph();
    this.setupEventBus();
    this.setupRealtimeAPICallback();
  }

  public async initialize() {
    this.aboutTodayAgent = await PostAboutTodayAgent.create();
    this.weatherAgent = await PostWeatherAgent.create();
    this.fortuneAgent = await PostFortuneAgent.create();
    this.replyTwitterCommentAgent = await ReplyTwitterCommentAgent.create();
    this.replyYoutubeCommentAgent = await ReplyYoutubeCommentAgent.create();
    console.log('\x1b[36mLLM Service initialized\x1b[0m');
  }

  private setupEventBus() {
    this.eventBus.subscribe('llm:get_web_message', (event) => {
      this.processWebMessage(event.data as OpenAIMessageOutput);
    });

    this.eventBus.subscribe('llm:get_discord_message', (event) => {
      this.processDiscordMessage(event.data as DiscordSendTextMessageOutput);
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
        reply: reply + ' by シャノン',
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

  private async processWebMessage(message: any) {
    try {
      if (message.type === 'realtime_text') {
        if (message as OpenAIRealTimeTextInput) {
          await this.realtimeApi.inputText(message.realtime_text);
        }
        return;
      } else if (
        message.type === 'realtime_audio' &&
        message.command === 'realtime_audio_append'
      ) {
        if (message as OpenAIRealTimeAudioInput) {
          await this.realtimeApi.inputAudioBufferAppend(message.realtime_audio);
        }
        return;
      } else if (
        message.type === 'realtime_audio' &&
        message.command === 'realtime_audio_commit'
      ) {
        if (message as OpenAICommandInput) {
          await this.realtimeApi.inputAudioBufferCommit();
        }
        return;
      } else if (message.command === 'realtime_vad_on') {
        if (message as OpenAICommandInput) {
          await this.realtimeApi.vadModeChange(true);
        }
        return;
      } else if (message.command === 'realtime_vad_off') {
        if (message as OpenAICommandInput) {
          await this.realtimeApi.vadModeChange(false);
        }
        return;
      } else if (message.type === 'text') {
        if (message as OpenAITextInput) {
          await this.processMessage(
            'web',
            'null',
            message.text,
            'This message is from ShannonUI',
            message.recentChatLog
          );
        }
      }
    } catch (error) {
      console.error('LLM処理エラー:', error);
    }
  }

  private async processDiscordMessage(message: DiscordSendTextMessageOutput) {
    try {
      if (message.type === 'text') {
        const info = {
          guildName: message.guildName,
          channelName: message.channelName,
          guildId: message.guildId,
          channelId: message.channelId,
          messageId: message.messageId,
          userId: message.userId,
        };
        const infoMessage = JSON.stringify(info, null, 2);
        const memoryZone = await getDiscordMemoryZone(message.guildId);

        await this.processMessage(
          memoryZone,
          message.userName,
          message.text,
          infoMessage,
          message.recentMessages
        );
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
    this.eventBus.log('twitter:schedule_post', 'green', post, true);
    this.eventBus.log('discord:toyama_server', 'green', postForToyama, true);
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
      type: 'discord:scheduled_post',
      memoryZone: 'discord:toyama_server',
      data: {
        command: message.command,
        text: postForToyama,
      } as DiscordScheduledPostInput,
    });
  }

  private async processMessage(
    inputMemoryZone: MemoryZone,
    userName?: string | null,
    message?: string | null,
    infoMessage?: string | null,
    recentMessages?: BaseMessage[] | null
  ) {
    try {
      const currentTime = new Date().toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
      });
      const newMessage = `${currentTime} ${userName}: ${message}`;
      await this.taskGraph.invoke({
        memoryZone: inputMemoryZone,
        environmentState: infoMessage || null,
        messages: recentMessages?.concat([new HumanMessage(newMessage)]) || [],
        userMessage: newMessage,
      });
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
}

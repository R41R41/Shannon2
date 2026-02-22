import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';
import {
  DiscordScheduledPostInput,
  DiscordSendTextMessageOutput,
  MemberTweetInput,
  MemoryZone,
  OpenAICommandInput,
  OpenAIMessageOutput,
  OpenAIRealTimeAudioInput,
  OpenAIRealTimeTextInput,
  OpenAITextInput,
  SkillInfo,
  TaskContext,
  TwitterAutoTweetInput,
  TwitterClientInput,
  TwitterQuoteRTOutput,
  TwitterReplyOutput,
  YoutubeClientInput,
  YoutubeCommentOutput,
  YoutubeLiveChatMessageInput,
  YoutubeLiveChatMessageOutput,
} from '@shannon/common';
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { getDiscordMemoryZone } from '../../utils/discord.js';
import { EventBus } from '../eventBus/eventBus.js';
import { getEventBus } from '../eventBus/index.js';
import { AutoTweetAgent } from './agents/autoTweetAgent.js';
import { MemberTweetAgent } from './agents/memberTweetAgent.js';
import { PostAboutTodayAgent } from './agents/postAboutTodayAgent.js';
import { PostFortuneAgent } from './agents/postFortuneAgent.js';
import { PostNewsAgent } from './agents/postNewsAgent.js';
import { PostWeatherAgent } from './agents/postWeatherAgent.js';
import { generateImage } from './utils/generateImage.js';
import { QuoteTwitterCommentAgent } from './agents/quoteTwitterComment.js';
import { RealtimeAPIService } from './agents/realtimeApiAgent.js';
import { ReplyTwitterCommentAgent } from './agents/replyTwitterComment.js';
import { ReplyYoutubeCommentAgent } from './agents/replyYoutubeComment.js';
import { ReplyYoutubeLiveCommentAgent } from './agents/replyYoutubeLiveCommentAgent.js';
import { TaskGraph } from './graph/taskGraph.js';
import { logger } from '../../utils/logger.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class LLMService {
  private static instance: LLMService;
  private eventBus: EventBus;
  private realtimeApi: RealtimeAPIService;
  private taskGraph: TaskGraph;
  private aboutTodayAgent!: PostAboutTodayAgent;
  private weatherAgent!: PostWeatherAgent;
  private fortuneAgent!: PostFortuneAgent;
  private newsAgent!: PostNewsAgent;
  private replyTwitterCommentAgent!: ReplyTwitterCommentAgent;
  private quoteTwitterCommentAgent!: QuoteTwitterCommentAgent;
  private replyYoutubeCommentAgent!: ReplyYoutubeCommentAgent;
  private replyYoutubeLiveCommentAgent!: ReplyYoutubeLiveCommentAgent;
  private autoTweetAgent!: AutoTweetAgent;
  private memberTweetAgent!: MemberTweetAgent;
  private tools: StructuredTool[] = [];
  private isDevMode: boolean;
  constructor(isDevMode: boolean) {
    this.isDevMode = isDevMode;
    this.eventBus = getEventBus();
    this.realtimeApi = RealtimeAPIService.getInstance();
    this.taskGraph = TaskGraph.getInstance();
    this.setupEventBus();
    this.setupRealtimeAPICallback();
  }

  public static getInstance(isDevMode: boolean): LLMService {
    if (!LLMService.instance) {
      LLMService.instance = new LLMService(isDevMode);
    }
    return LLMService.instance;
  }

  public async initialize() {
    // TaskGraphを初期化（ツール読み込み、ノード初期化）
    await this.taskGraph.initialize();

    // 各種エージェントを初期化（単発タスク用）
    this.aboutTodayAgent = await PostAboutTodayAgent.create();
    this.weatherAgent = await PostWeatherAgent.create();
    this.fortuneAgent = await PostFortuneAgent.create();
    this.replyTwitterCommentAgent = await ReplyTwitterCommentAgent.create();
    this.quoteTwitterCommentAgent = QuoteTwitterCommentAgent.create();
    this.replyYoutubeCommentAgent = await ReplyYoutubeCommentAgent.create();
    this.replyYoutubeLiveCommentAgent =
      await ReplyYoutubeLiveCommentAgent.create();
    this.newsAgent = await PostNewsAgent.create();
    this.autoTweetAgent = await AutoTweetAgent.create();
    this.memberTweetAgent = await MemberTweetAgent.create();
    logger.info('LLM Service initialized', 'cyan');
  }

  private setupEventBus() {
    this.eventBus.subscribe('llm:get_web_message', (event) => {
      this.processWebMessage(event.data as OpenAIMessageOutput);
    });

    this.eventBus.subscribe('llm:get_discord_message', (event) => {
      this.processDiscordMessage(event.data as DiscordSendTextMessageOutput);
    });

    this.eventBus.subscribe('llm:post_scheduled_message', (event) => {
      if (this.isDevMode) return;
      this.processCreateScheduledPost(event.data as TwitterClientInput);
    });

    this.eventBus.subscribe('llm:post_twitter_reply', (event) => {
      this.processTwitterReply(event.data as TwitterReplyOutput).catch((err) => {
        logger.error('[Twitter Reply] 未処理エラー:', err);
      });
    });

    this.eventBus.subscribe('llm:post_twitter_quote_rt', (event) => {
      if (this.isDevMode) return;
      this.processTwitterQuoteRT(event.data as TwitterQuoteRTOutput);
    });

    this.eventBus.subscribe('llm:respond_member_tweet', (event) => {
      if (this.isDevMode) return;
      this.processMemberTweet(event.data as MemberTweetInput).catch((err) => {
        logger.error('[MemberTweet] 未処理エラー:', err);
      });
    });

    this.eventBus.subscribe('llm:generate_auto_tweet', (event) => {
      this.processAutoTweet(event.data as TwitterAutoTweetInput);
    });

    this.eventBus.subscribe('llm:reply_youtube_comment', (event) => {
      if (this.isDevMode) return;
      this.processYoutubeReply(event.data as YoutubeCommentOutput);
    });

    this.eventBus.subscribe('llm:get_skills', (event) => {
      this.processGetSkills();
    });

    this.eventBus.subscribe('llm:get_youtube_message', (event) => {
      this.processYoutubeMessage(event.data as YoutubeLiveChatMessageOutput);
    });
  }

  private async getTools() {
    const toolsDir = join(__dirname, './tools');
    const toolFiles = readdirSync(toolsDir).filter(
      (file) => file.endsWith('.js') && !file.includes('.js.map')
    );

    this.tools = [];

    for (const file of toolFiles) {
      if (file === 'index.ts' || file === 'index.js') continue;
      try {
        const toolPath = join(toolsDir, file);
        const toolModule = await import(toolPath);
        const ToolClass = toolModule.default;
        // ツールが既に読み込まれているかチェック
        if (this.tools.find((tool) => tool.name === ToolClass.name)) continue;
        if (ToolClass?.prototype?.constructor) {
          this.tools.push(new ToolClass());
        }
      } catch (error) {
        logger.error(`ツール読み込みエラー: ${file}`, error);
      }
    }
  }

  private async processGetSkills() {
    if (this.tools.length === 0) {
      await this.getTools();
    }

    const skills = this.tools.map((tool) => {
      return {
        name: tool.name.toString(),
        description: tool.description.toString(),
        parameters: Object.entries(
          (tool.schema as z.ZodObject<z.ZodRawShape>).shape
        ).map(([name, value]) => ({
          name,
          description: (value as z.ZodTypeAny)._def.description,
        })),
      };
    });
    const uniqueSkills = skills.filter(
      (skill, index, self) =>
        index === self.findIndex((t) => t.name === skill.name)
    );
    this.eventBus.publish({
      type: 'web:skill',
      memoryZone: 'web',
      data: uniqueSkills as SkillInfo[],
    });
  }

  private async processYoutubeReply(data: YoutubeCommentOutput) {
    const comment = data.text;
    const videoTitle = data.videoTitle;
    const videoDescription = data.videoDescription;
    const authorName = data.authorName;
    const reply = await this.replyYoutubeCommentAgent.reply(
      comment,
      videoTitle,
      videoDescription,
      authorName,
      data.authorChannelId,
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

  private async processYoutubeMessage(data: YoutubeLiveChatMessageOutput) {
    const message = data.message;
    const author = data.author;
    const jstNow = data.jstNow;
    const minutesSinceStart = data.minutesSinceStart;
    const history = data.history;
    const liveTitle = data.liveTitle;
    const liveDescription = data.liveDescription;

    const response = await this.replyYoutubeLiveCommentAgent.reply(
      message,
      author,
      jstNow,
      minutesSinceStart,
      history,
      liveTitle,
      liveDescription,
      data.authorChannelId,
    );
    this.eventBus.publish({
      type: 'youtube:live_chat:post_message',
      memoryZone: 'youtube',
      data: {
        response: response,
      } as YoutubeLiveChatMessageInput,
    });
  }

  private async processTwitterReply(data: TwitterReplyOutput) {
    const text = data.text;
    const replyId = data.replyId;
    const authorName = data.authorName;
    const repliedTweet = data.repliedTweet;
    const repliedTweetAuthorName = data.repliedTweetAuthorName;
    const conversationThread = data.conversationThread;

    if (!text || !replyId || !authorName) {
      logger.error('Twitter reply data is invalid:', { text, replyId, authorName });
      return;
    }

    try {
      logger.info(`[Twitter Reply] LLM生成開始: @${authorName} "${text.slice(0, 50)}" (スレッド: ${conversationThread?.length ?? 0}件)`);
      const response = await this.replyTwitterCommentAgent.reply(
        text,
        authorName,
        repliedTweet,
        repliedTweetAuthorName,
        conversationThread,
        data.authorId,
      );
      logger.info(`[Twitter Reply] LLM生成完了: "${response.slice(0, 80)}"`);
      this.eventBus.publish({
        type: 'twitter:post_message',
        memoryZone: 'twitter:post',
        data: {
          text: response,
          replyId: replyId,
        } as TwitterClientInput,
      });
    } catch (error) {
      logger.error('[Twitter Reply] エラー:', error);
    }
  }

  private async processTwitterQuoteRT(data: TwitterQuoteRTOutput) {
    const { tweetId, tweetUrl, text, authorName, authorUserName } = data;

    if (!tweetId || !tweetUrl || !text || !authorName) {
      logger.error('Twitter quote RT data is invalid');
      return;
    }

    const quoteText = await this.quoteTwitterCommentAgent.generateQuote(
      text,
      authorName,
      authorUserName
    );
    this.eventBus.publish({
      type: 'twitter:post_message',
      memoryZone: 'twitter:post',
      data: {
        text: quoteText,
        quoteTweetUrl: tweetUrl,
      } as TwitterClientInput,
    });
  }

  private async processMemberTweet(data: MemberTweetInput) {
    const { tweetId, tweetUrl, text, authorName } = data;

    if (!tweetId || !text || !authorName) {
      logger.error('MemberTweet data is invalid:', { tweetId, text, authorName });
      return;
    }

    try {
      logger.info(
        `[MemberTweet] FCA開始: @${data.authorUserName} "${text.slice(0, 50)}"`,
        'cyan',
      );

      const result = await this.memberTweetAgent.respond(data);
      if (!result) {
        logger.warn('[MemberTweet] FCA結果なし');
        return;
      }

      if (result.type === 'quote_rt') {
        logger.info(
          `[MemberTweet] 引用RT選択: "${result.text.slice(0, 60)}" → ${tweetUrl}`,
          'green',
        );
        this.eventBus.publish({
          type: 'twitter:post_message',
          memoryZone: 'twitter:post',
          data: {
            text: result.text,
            quoteTweetUrl: tweetUrl,
          } as TwitterClientInput,
        });
      } else {
        logger.info(
          `[MemberTweet] 返信選択: "${result.text.slice(0, 60)}"`,
          'green',
        );
        this.eventBus.publish({
          type: 'twitter:post_message',
          memoryZone: 'twitter:post',
          data: {
            text: result.text,
            replyId: tweetId,
          } as TwitterClientInput,
        });
      }
    } catch (error) {
      logger.error('[MemberTweet] エラー:', error);
    }
  }

  private async processAutoTweet(data: TwitterAutoTweetInput) {
    try {
      const { trends, todayInfo, recentPosts, recentQuoteUrls, mode, recentTopics } = data;

      logger.info(`🐦 AutoTweet: ツイート生成中 (mode=${mode}, トレンド${trends.length}件, 直近ポスト${recentPosts?.length ?? 0}件, トピック${recentTopics?.length ?? 0}件)...`);
      const result = await this.autoTweetAgent.generateTweet(trends, todayInfo, recentPosts, recentQuoteUrls, mode, recentTopics);

      if (!result) {
        logger.warn('🐦 AutoTweet: ツイート生成失敗（レビュー不合格 or 空の結果）');
        return;
      }

      if (result.type === 'quote_rt' && result.quoteUrl) {
        if (recentQuoteUrls && recentQuoteUrls.length > 0) {
          const resultId = result.quoteUrl.match(/status\/(\d+)/)?.[1];
          const isDuplicate = recentQuoteUrls.some((u) => {
            if (u === result.quoteUrl) return true;
            const existingId = u.match(/status\/(\d+)/)?.[1];
            return resultId && existingId && resultId === existingId;
          });
          if (isDuplicate) {
            logger.warn(`🐦 AutoTweet: 引用RT重複検出、投稿スキップ → ${result.quoteUrl}`);
            return;
          }
        }
        logger.info(`🐦 AutoTweet: 引用RT生成完了「${result.text}」→ ${result.quoteUrl}`);
        this.eventBus.publish({
          type: 'twitter:post_scheduled_message',
          memoryZone: 'twitter:post',
          data: {
            text: result.text,
            quoteTweetUrl: result.quoteUrl,
            topic: result.topic,
          } as TwitterClientInput,
        });
      } else {
        logger.info(`🐦 AutoTweet: 生成完了「${result.text}」`);
        this.eventBus.publish({
          type: 'twitter:post_scheduled_message',
          memoryZone: 'twitter:post',
          data: {
            text: result.text,
            topic: result.topic,
          } as TwitterClientInput,
        });
      }
    } catch (error) {
      logger.error('🐦 AutoTweet エラー:', error);
    }
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
            message.senderName,
            message.text,
            'This message is from ShannonUI',
            message.recentChatLog
          );
        }
      }
    } catch (error) {
      logger.error('LLM処理エラー:', error);
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

        // TaskContextを構築（詳細なDiscord情報を含む）
        const context: TaskContext = {
          platform: 'discord',
          discord: {
            guildId: message.guildId,
            guildName: message.guildName,
            channelId: message.channelId,
            channelName: message.channelName,
            messageId: message.messageId,
            userId: message.userId,
            userName: message.userName,
          },
        };

        await this.processMessage(
          memoryZone,
          message.userName,
          message.text,
          infoMessage,
          message.recentMessages,
          message.channelId,
          context
        );
        return;
      }
    } catch (error) {
      logger.error('LLM処理エラー:', error);
      throw error;
    }
  }

  private async processCreateScheduledPost(message: TwitterClientInput) {
    let post = '';
    let postForToyama = '';
    let imagePrompt: string | undefined;

    if (message.command === 'forecast') {
      const result = await this.weatherAgent.createPost();
      post = result.text;
      imagePrompt = result.imagePrompt;
      postForToyama = await this.weatherAgent.createPostForToyama();
    } else if (message.command === 'fortune') {
      const result = await this.fortuneAgent.createPost();
      post = result.text;
      imagePrompt = result.imagePrompt;
      postForToyama = post;
    } else if (message.command === 'about_today') {
      const result = await this.aboutTodayAgent.createPost();
      post = result.text;
      imagePrompt = result.imagePrompt;
      postForToyama = post;
    } else if (message.command === 'news_today') {
      const result = await this.newsAgent.createPost();
      post = result.text;
      imagePrompt = result.imagePrompt;
      postForToyama = post;
    }

    // 画像生成（全 command 共通）
    let mediaId: string | null = null;
    let imageBuffer: Buffer | null = null;
    if (imagePrompt) {
      try {
        imageBuffer = await generateImage(imagePrompt, '1024x1024', 'low');
        if (imageBuffer && !this.isDevMode) {
          const { TwitterClient } = await import('../twitter/client.js');
          const twitterClient = TwitterClient.getInstance();
          mediaId = await twitterClient.uploadMedia(imageBuffer, `${message.command}.jpg`) ?? null;
          if (mediaId) {
            logger.info(`[ScheduledPost] ${message.command} 画像アップロード成功: ${mediaId}`, 'green');
          }
        }
      } catch (imgErr) {
        logger.warn(`[ScheduledPost] ${message.command} 画像生成/アップロード失敗（テキストのみ投稿）: ${imgErr}`);
      }
    }

    if (this.isDevMode) {
      this.eventBus.publish({
        type: 'discord:scheduled_post',
        memoryZone: 'discord:test_server',
        data: {
          command: message.command,
          text: post,
          ...(imageBuffer ? { imageBuffer } : {}),
        } as DiscordScheduledPostInput,
      });
      this.eventBus.publish({
        type: 'discord:scheduled_post',
        memoryZone: 'discord:test_server',
        data: {
          command: message.command,
          text: postForToyama,
          ...(imageBuffer ? { imageBuffer } : {}),
        } as DiscordScheduledPostInput,
      });
    } else {
      this.eventBus.log('twitter:schedule_post', 'green', post, true);
      this.eventBus.log('discord:toyama_server', 'green', postForToyama, true);
      this.eventBus.publish({
        type: 'twitter:post_scheduled_message',
        memoryZone: 'twitter:schedule_post',
        data: {
          text: post,
          imageUrl: mediaId,
        } as TwitterClientInput,
      });
      this.eventBus.publish({
        type: 'discord:scheduled_post',
        memoryZone: 'discord:toyama_server',
        data: {
          command: message.command,
          text: postForToyama,
          ...(imageBuffer ? { imageBuffer } : {}),
        } as DiscordScheduledPostInput,
      });
      this.eventBus.publish({
        type: 'discord:scheduled_post',
        memoryZone: 'discord:douki_server',
        data: {
          command: message.command,
          text: post,
          ...(imageBuffer ? { imageBuffer } : {}),
        } as DiscordScheduledPostInput,
      });
    }
  }

  private async processMessage(
    inputMemoryZone: MemoryZone,
    userName?: string | null,
    message?: string | null,
    infoMessage?: string | null,
    recentMessages?: BaseMessage[] | null,
    channelId?: string | null,
    context?: TaskContext | null
  ) {
    try {
      const currentTime = new Date().toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
      });
      const newMessage = `${currentTime} ${userName}: ${message}`;

      // TaskContextを構築（新しい形式を優先）
      const taskContext: TaskContext = context || {
        platform: inputMemoryZone.startsWith('discord:') ? 'discord' :
          inputMemoryZone.startsWith('twitter:') ? 'twitter' :
            inputMemoryZone === 'youtube' ? 'youtube' :
              'web',
        discord: inputMemoryZone.startsWith('discord:') ? {
          guildName: inputMemoryZone.replace('discord:', ''),
          channelId: channelId || undefined,
        } : undefined,
      };

      await this.taskGraph.invoke({
        channelId: channelId,
        memoryZone: inputMemoryZone,
        context: taskContext,
        environmentState: infoMessage || null,
        messages: recentMessages?.concat([new HumanMessage(newMessage)]) || [],
        userMessage: newMessage,
      });
    } catch (error) {
      logger.error(`LLM処理エラー:${error}`);
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

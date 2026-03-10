import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';
import {
  DiscordScheduledPostInput,
  DiscordSendTextMessageOutput,
  DiscordVoiceEnqueueInput,
  DiscordVoiceMessageOutput,
  DiscordVoiceQueueEndInput,
  DiscordVoiceQueueStartInput,
  DiscordVoiceResponseInput,
  DiscordVoiceStatusInput,
  DiscordVoiceStreamTextInput,
  EmotionType,
  MemberTweetInput,
  MinebotVoiceResponseOutput,
  OpenAICommandInput,
  OpenAIMessageOutput,
  OpenAIRealTimeAudioInput,
  OpenAIRealTimeTextInput,
  OpenAITextInput,
  SkillInfo,
  TwitterAutoTweetInput,
  TwitterClientInput,
  TwitterQuoteRTOutput,
  TwitterReplyOutput,
  YoutubeClientInput,
  YoutubeCommentOutput,
  YoutubeLiveChatMessageInput,
  YoutubeLiveChatMessageOutput,
} from '@shannon/common';
import OpenAI from 'openai';
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { config } from '../../config/env.js';
import { getDiscordMemoryZone } from '../../utils/discord.js';
import { EventBus } from '../eventBus/eventBus.js';
import { getEventBus } from '../eventBus/index.js';
import { voiceResponseChannelIds } from '../discord/voiceState.js';
import { areFillersReady, selectFiller, getFillerSequence, getToolFillerAudio, getPreToolFillerAudio, type FillerSelection } from '../discord/voiceFiller.js';
import { VoicepeakClient } from '../voicepeak/client.js';
import { loadPrompt } from './config/prompts.js';
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
import { buildShannonGraph, invokeShannonGraph, CompiledShannonGraph } from './graph/shannonGraph.js';
import { initializeNodes } from './graph/nodeFactory.js';
import { FunctionCallingAgent } from './graph/nodes/FunctionCallingAgent.js';
import { RequestExecutionCoordinator } from './graph/requestExecutionCoordinator.js';
import type { RequestEnvelope, ShannonGraphState } from '@shannon/common';
import {
  discordAdapter,
  webAdapter,
  xAdapter,
  getActionDispatcher,
  type DiscordNativeEvent,
} from '../common/adapters/index.js';
import { getTracedOpenAI } from './utils/langfuse.js';
import { logger } from '../../utils/logger.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VOICE_ALLOWED_TOOLS = [
  'google-search', 'fetch-url', 'chat-on-discord',
  'get-discord-images', 'describe-image', 'wolfram-alpha',
  'search-by-wikipedia', 'get-discord-recent-messages',
  'search-weather',
];

function splitIntoSentences(text: string): string[] {
  const parts = text.split(/(?<=[。！？!?])\s*/);
  const sentences: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length > 0) sentences.push(trimmed);
  }
  return sentences.length > 0 ? sentences : [text];
}

export class LLMService {
  private static instance: LLMService;
  private eventBus: EventBus;
  private realtimeApi: RealtimeAPIService;
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
  private voicepeakClient: VoicepeakClient;
  private openaiClient: OpenAI;
  private groqClient: OpenAI;
  private voiceCharacterPrompt: string = '';
  private shannonGraph: CompiledShannonGraph | null = null;
  private unifiedFca: FunctionCallingAgent | null = null;
  private initializationPromise: Promise<void> | null = null;
  private executionCoordinator = RequestExecutionCoordinator.getInstance();
  constructor(isDevMode: boolean) {
    this.isDevMode = isDevMode;
    this.eventBus = getEventBus();
    this.realtimeApi = RealtimeAPIService.getInstance();
    this.voicepeakClient = VoicepeakClient.getInstance();
    this.openaiClient = getTracedOpenAI(new OpenAI({ apiKey: config.openaiApiKey }));
    this.groqClient = getTracedOpenAI(new OpenAI({
      apiKey: config.groq.apiKey || config.openaiApiKey,
      baseURL: config.groq.apiKey ? 'https://api.groq.com/openai/v1' : undefined,
    }));
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
    if (this.shannonGraph && this.unifiedFca) {
      return;
    }
    if (this.initializationPromise) {
      await this.initializationPromise;
      return;
    }

    this.initializationPromise = (async () => {
      // プロンプトホットリロードを有効化
      const { enablePromptHotReload } = await import('./config/prompts.js');
      enablePromptHotReload();

      // Initialize nodes and build unified Shannon graph
      const { emotionNode, fca } = await initializeNodes();
      this.unifiedFca = fca;
      this.shannonGraph = buildShannonGraph({ emotionNode, fca });

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

      try {
        this.voiceCharacterPrompt = await loadPrompt('base_voice');
      } catch {
        logger.warn('[LLM] Failed to load base_voice prompt, voice will use default character');
      }

      logger.info('LLM Service initialized', 'cyan');
    })();

    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
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

    this.eventBus.subscribe('minebot:voice_response', (event) => {
      this.processMinebotVoiceResponse(event.data as MinebotVoiceResponseOutput).catch((err) => {
        logger.error('[Minebot Voice] 未処理エラー:', err);
      });
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
      logger.info(`[Twitter Reply] Unified graph開始: @${authorName} "${text.slice(0, 50)}" (スレッド: ${conversationThread?.length ?? 0}件)`);
      const envelope = xAdapter.toEnvelope({
        replyId,
        text,
        authorName,
        authorId: data.authorId ?? undefined,
        repliedTweet: repliedTweet ?? undefined,
        repliedTweetAuthorName: repliedTweetAuthorName ?? undefined,
      });
      const history = (conversationThread ?? []).map(
        (entry) => new HumanMessage(`${entry.authorName}: ${entry.text}`),
      );
      await this.invokeGraph(envelope, history);
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
    const { tweetId, text, authorName } = data;

    if (!tweetId || !text || !authorName) {
      logger.error('MemberTweet data is invalid:', { tweetId, text, authorName });
      return;
    }

    try {
      logger.info(
        `[MemberTweet] Unified graph開始: @${data.authorUserName} "${text.slice(0, 50)}"`,
        'cyan',
      );
      const envelope = xAdapter.toEnvelope({
        tweetId,
        text,
        authorName,
        authorId: data.authorId ?? authorName,
      });
      const history = (data.conversationThread ?? []).map(
        (entry) => new HumanMessage(`${entry.authorName}: ${entry.text}`),
      );
      await this.invokeGraph(envelope, history);
    } catch (error) {
      logger.error('[MemberTweet] エラー:', error);
    }
  }

  private isQuoteUrlDuplicate(quoteUrl: string, urls: string[]): boolean {
    const resultId = quoteUrl.match(/status\/(\d+)/)?.[1];
    return urls.some((u) => {
      if (u === quoteUrl) return true;
      const existingId = u.match(/status\/(\d+)/)?.[1];
      return resultId && existingId && resultId === existingId;
    });
  }

  private async processAutoTweet(data: TwitterAutoTweetInput) {
    const MAX_DUPLICATE_RETRIES = 2;
    try {
      const { trends, todayInfo, recentPosts, recentQuoteUrls: originalQuoteUrls, mode, recentTopics } = data;
      const blockedUrls = [...(originalQuoteUrls || [])];

      logger.info(`🐦 AutoTweet: ツイート生成中 (mode=${mode}, トレンド${trends.length}件, 直近ポスト${recentPosts?.length ?? 0}件, トピック${recentTopics?.length ?? 0}件)...`);

      for (let attempt = 0; attempt <= MAX_DUPLICATE_RETRIES; attempt++) {
        const result = await this.autoTweetAgent.generateTweet(
          trends, todayInfo, recentPosts, blockedUrls, mode, recentTopics,
        );

        if (!result) {
          logger.warn('🐦 AutoTweet: ツイート生成失敗（レビュー不合格 or 空の結果）');
          return;
        }

        if (result.type === 'quote_rt' && result.quoteUrl) {
          if (this.isQuoteUrlDuplicate(result.quoteUrl, blockedUrls)) {
            if (attempt < MAX_DUPLICATE_RETRIES) {
              blockedUrls.push(result.quoteUrl);
              logger.warn(`🐦 AutoTweet: 引用RT重複検出、リトライ ${attempt + 1}/${MAX_DUPLICATE_RETRIES} → ${result.quoteUrl}`);
              continue;
            }
            logger.warn(`🐦 AutoTweet: 引用RT重複がリトライ上限に達した、投稿スキップ → ${result.quoteUrl}`);
            return;
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
          return;
        }

        logger.info(`🐦 AutoTweet: 生成完了「${result.text}」`);
        this.eventBus.publish({
          type: 'twitter:post_scheduled_message',
          memoryZone: 'twitter:post',
          data: {
            text: result.text,
            topic: result.topic,
          } as TwitterClientInput,
        });
        return;
      }
    } catch (error) {
      logger.error('🐦 AutoTweet エラー:', error);
    }
  }

  private async processWebMessage(message: any) {
    try {
      // Realtime audio/text passthrough (not graph-routed)
      if (message.type === 'realtime_text') {
        await this.realtimeApi.inputText(message.realtime_text);
        return;
      }
      if (message.type === 'realtime_audio' && message.command === 'realtime_audio_append') {
        await this.realtimeApi.inputAudioBufferAppend(message.realtime_audio);
        return;
      }
      if (message.type === 'realtime_audio' && message.command === 'realtime_audio_commit') {
        await this.realtimeApi.inputAudioBufferCommit();
        return;
      }
      if (message.command === 'realtime_vad_on') {
        await this.realtimeApi.vadModeChange(true);
        return;
      }
      if (message.command === 'realtime_vad_off') {
        await this.realtimeApi.vadModeChange(false);
        return;
      }

      // Text message → unified graph via web adapter
      if (message.type === 'text') {
        const currentTime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
        const envelope = webAdapter.toEnvelope({
          type: 'text',
          text: `${currentTime} ${message.senderName}: ${message.text}`,
          senderName: message.senderName,
          recentChatLog: message.recentChatLog,
          sessionId: message.sessionId,
        });
        await this.invokeGraph(envelope);
      }
    } catch (error) {
      logger.error('LLM処理エラー:', error);
    }
  }

  private async processDiscordMessage(message: DiscordSendTextMessageOutput | DiscordVoiceMessageOutput) {
    try {
      if (message.type === 'text') {
        const textMsg = message as DiscordSendTextMessageOutput;
        const currentTime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

        // Build envelope via ChannelAdapter
        const envelope = discordAdapter.toEnvelope({
          text: `${currentTime} ${textMsg.userName}: ${textMsg.text}`,
          type: textMsg.type,
          guildName: textMsg.guildName,
          channelId: textMsg.channelId,
          guildId: textMsg.guildId,
          channelName: textMsg.channelName,
          userName: textMsg.userName,
          messageId: textMsg.messageId,
          userId: textMsg.userId,
          recentMessages: textMsg.recentMessages as unknown[],
        } as DiscordNativeEvent);

        const msgs = textMsg.recentMessages
          ? [...textMsg.recentMessages, new HumanMessage(`${currentTime} ${textMsg.userName}: ${textMsg.text}`)]
          : [];

        await this.invokeGraph(envelope, msgs);
        return;
      }

      if (message.type === 'voice') {
        await this.processDiscordVoiceMessage(message as DiscordVoiceMessageOutput);
        return;
      }
    } catch (error) {
      logger.error('LLM処理エラー:', error);
      throw error;
    }
  }

  private publishVoiceStatus(memoryZone: string, guildId: string, status: string, detail?: string) {
    this.eventBus.publish({
      type: 'discord:voice_status',
      memoryZone: memoryZone as any,
      data: { guildId, status, detail } as DiscordVoiceStatusInput,
    });
  }

  private async getVoiceMode(guildId: string): Promise<'chat' | 'minebot'> {
    try {
      const { DiscordBot } = await import('../discord/client.js');
      return DiscordBot.getInstance().getVoiceMode(guildId);
    } catch {
      return 'chat';
    }
  }

  private async processDiscordVoiceMessage(message: DiscordVoiceMessageOutput) {
    const memoryZone = await getDiscordMemoryZone(message.guildId);
    const voiceMsg = message as any;
    const audioBuffer: Buffer = voiceMsg.audioBuffer;
    const directText: string | undefined = voiceMsg.text;
    const isDirectText = !!directText && directText.length > 0;

    if (!isDirectText && (!audioBuffer || audioBuffer.length === 0)) {
      logger.warn('[LLM] Empty audio buffer received from Discord voice');
      return;
    }

    // 1. STT (skip if text provided directly via "音声回答を生成" button)
    const voiceStartTime = Date.now();
    let transcribedText: string;
    let sttMs = 0;

    if (isDirectText) {
      transcribedText = directText!;
      logger.info(`[LLM] Voice direct text input: "${transcribedText}" from ${message.userName}`, 'cyan');
    } else {
      this.publishVoiceStatus(memoryZone, message.guildId, 'stt');
      try {
        const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/wav' });
        const audioFile = new File([audioBlob], 'voice.wav', { type: 'audio/wav' });

        const sttClient = config.groq.apiKey ? this.groqClient : this.openaiClient;
        const sttModel = config.groq.apiKey ? 'whisper-large-v3-turbo' : 'whisper-1';
        const transcription = await sttClient.audio.transcriptions.create({
          model: sttModel,
          file: audioFile,
          language: 'ja',
          prompt: 'シャノンとの日常会話です。',
        });
        transcribedText = transcription.text.trim();
      } catch (error) {
        logger.error('[LLM] Whisper STT failed:', error);
        return;
      }
      sttMs = Date.now() - voiceStartTime;

      if (!transcribedText || transcribedText.length === 0) {
        logger.info('[LLM] Empty transcription, skipping', 'yellow');
        return;
      }

      const whisperHallucinations = [
        'ご視聴ありがとうございました',
        'ご視聴いただきありがとうございます',
        'ご視聴頂きありがとうございました',
        'チャンネル登録よろしくお願いします',
        '字幕は自動生成されています',
        'ご視聴ありがとうございます',
        'おやすみなさい',
        'Thanks for watching',
        'Thank you for watching',
        'Subscribe to my channel',
        'Subtitles by',
        'はじめしゃちょー',
        'エンディング',
        'チャンネル登録',
        '高評価',
        'いいねボタン',
        'お気に入り登録',
        '次の動画',
        '次回の動画',
        '次回へつづき',
        'お楽しみに',
        'ご覧いただき',
        'グッドボタン',
        'よろしくお願いします',
        '最後までご視聴',
      ];
      if (whisperHallucinations.some(h => transcribedText.includes(h))) {
        logger.info(`[LLM] Whisper hallucination filtered: "${transcribedText}"`, 'yellow');
        return;
      }

      logger.info(`[LLM] Voice STT (${sttMs}ms): "${transcribedText}" from ${message.userName}`, 'cyan');
    }

    // Post transcribed text to Discord (skip for direct text - already visible in chat)
    if (!isDirectText) {
      this.eventBus.publish({
        type: 'discord:post_message',
        memoryZone,
        data: {
          channelId: message.channelId,
          guildId: message.guildId,
          text: `🎤 ${message.userName}: ${transcribedText}`,
          imageUrl: '',
        },
      });
    }

    // 2. Filler selection (fast ~300ms with mini)
    this.publishVoiceStatus(memoryZone, message.guildId, 'filler_select');
    const fillerStartTime = Date.now();
    let fillerResult: FillerSelection = { fillerIds: [], fillerOnly: false, needsTools: false };
    let fillerSequence: { audioBuffers: Buffer[]; combinedText: string; totalDurationMs: number } | null = null;

    if (areFillersReady()) {
      try {
        const recentContext = message.recentMessages
          ?.slice(-5)
          .map(m => m.content?.toString().replace(/^\d{4}\/\d{1,2}\/\d{1,2} \d{1,2}:\d{1,2}:\d{1,2} /, '') ?? '')
          .filter(Boolean)
          .join('\n') || '';
        fillerResult = await selectFiller(transcribedText, message.userName, recentContext || undefined);
        if (fillerResult.fillerIds.length > 0) {
          fillerSequence = getFillerSequence(fillerResult.fillerIds);
          const fillerMs = Date.now() - fillerStartTime;
          logger.info(
            `[Voice] Filler selected: [${fillerResult.fillerIds.join('+')}] "${fillerSequence.combinedText}" ` +
            `(${Math.round(fillerSequence.totalDurationMs)}ms audio, fillerOnly=${fillerResult.fillerOnly}, needsTools=${fillerResult.needsTools}) (${fillerMs}ms)`,
            'cyan'
          );
        } else {
          const fillerMs = Date.now() - fillerStartTime;
          logger.info(`[Voice] No filler selected (${fillerMs}ms)`, 'cyan');
        }
      } catch {
        /* filler selection is best-effort */
      }
    }

    voiceResponseChannelIds.add(message.channelId);

    // 2b. Filler-only: queue fillers and return
    if (fillerResult.fillerOnly && fillerSequence && fillerSequence.audioBuffers.length > 0) {
      this.eventBus.publish({
        type: 'discord:voice_queue_start',
        memoryZone,
        data: { guildId: message.guildId, channelId: message.channelId } as DiscordVoiceQueueStartInput,
      });
      for (const buf of fillerSequence.audioBuffers) {
        this.eventBus.publish({
          type: 'discord:voice_enqueue',
          memoryZone,
          data: { guildId: message.guildId, audioBuffer: buf } as DiscordVoiceEnqueueInput,
        });
      }
      this.eventBus.publish({
        type: 'discord:voice_queue_end',
        memoryZone,
        data: {
          guildId: message.guildId,
          channelId: message.channelId,
          text: fillerSequence.combinedText,
        } as DiscordVoiceQueueEndInput,
      });
      const totalMs = Date.now() - voiceStartTime;
      logger.info(`[Voice] Filler-only response (${Math.round(fillerSequence.totalDurationMs)}ms audio). STT: ${sttMs}ms | Total: ${totalMs}ms`, 'cyan');
      voiceResponseChannelIds.delete(message.channelId);
      return;
    }

    // 3. Start voice queue and enqueue fillers immediately
    this.eventBus.publish({
      type: 'discord:voice_queue_start',
      memoryZone,
      data: { guildId: message.guildId, channelId: message.channelId } as DiscordVoiceQueueStartInput,
    });

    if (fillerSequence && fillerSequence.audioBuffers.length > 0) {
      for (const buf of fillerSequence.audioBuffers) {
        this.eventBus.publish({
          type: 'discord:voice_enqueue',
          memoryZone,
          data: { guildId: message.guildId, audioBuffer: buf } as DiscordVoiceEnqueueInput,
        });
      }
      logger.info(`[Voice] Filler enqueued (${fillerSequence.audioBuffers.length} clip(s), ${Math.round(fillerSequence.totalDurationMs)}ms)`, 'cyan');
    }

    // 3b. Pre-tool filler: enqueue a "please wait" clip when tools are expected
    let preToolText = '';
    if (fillerResult.needsTools) {
      const preToolFiller = getPreToolFillerAudio();
      if (preToolFiller) {
        this.eventBus.publish({
          type: 'discord:voice_enqueue',
          memoryZone,
          data: { guildId: message.guildId, audioBuffer: preToolFiller.audio } as DiscordVoiceEnqueueInput,
        });
        preToolText = preToolFiller.text;
        logger.info(`[Voice] Pre-tool filler enqueued: "${preToolFiller.text}"`, 'cyan');
      }
    }

    // 3c. Minebot mode: delegate to Minebot FCA instead of Shannon LLM
    const voiceMode = await this.getVoiceMode(message.guildId);
    if (voiceMode === 'minebot') {
      logger.info(`[Voice] Minebot mode — routing to minebot:voice_chat`, 'magenta');
      this.publishVoiceStatus(memoryZone, message.guildId, 'llm', '🤖 Minebot処理中...');
      this.eventBus.publish({
        type: 'minebot:voice_chat',
        memoryZone: 'minebot',
        data: {
          userName: message.userName,
          message: transcribedText,
          guildId: message.guildId,
          channelId: message.channelId,
        },
      });
      return;
    }

    // 4. Run LLM in parallel (fillers are already playing)
    this.publishVoiceStatus(memoryZone, message.guildId, 'llm');
    const llmStartTime = Date.now();
    const fillerCombinedText = [fillerSequence?.combinedText, preToolText].filter(Boolean).join('') || '';
    const userMessageForLlm = fillerCombinedText
      ? `${transcribedText}\n\n[system: 音声会話でフィラー「${fillerCombinedText}」が既に再生済みです。あなたの応答はフィラーの直後に音声で再生されます。重要なルール: (1) フィラーと同じ言葉・同じ意味の文を絶対に含めないこと (2) フィラーの続きとして自然に繋がる内容だけを生成すること (3) 挨拶・相槌・リアクション等はフィラーで済んでいるので、本題の回答から始めること]`
      : transcribedText;

    const info = {
      guildName: message.guildName,
      channelName: message.channelName,
      guildId: message.guildId,
      channelId: message.channelId,
      voiceChannelId: message.voiceChannelId,
      userId: message.userId,
      inputMethod: 'voice',
    };
    const infoJson = JSON.stringify(info, null, 2);
    const infoMessage = this.voiceCharacterPrompt
      ? `${infoJson}\n\n${this.voiceCharacterPrompt}`
      : infoJson;

    const responsePromise = new Promise<string>((resolve) => {
      const unsubscribe = this.eventBus.subscribe('discord:post_message', (event) => {
        const data = event.data as any;
        if (data.channelId === message.channelId && !data.text?.startsWith('🎤')) {
          unsubscribe();
          resolve(data.text ?? '');
        }
      });
      setTimeout(() => { unsubscribe(); resolve(''); }, 60000);
    });

    const voiceOnToolStarting = (toolName: string) => {
      this.publishVoiceStatus(memoryZone, message.guildId, 'llm', `🔧 ツール使用中: ${toolName}`);
      const toolAudio = getToolFillerAudio(toolName);
      if (toolAudio) {
        this.eventBus.publish({
          type: 'discord:voice_enqueue',
          memoryZone,
          data: { guildId: message.guildId, audioBuffer: toolAudio } as DiscordVoiceEnqueueInput,
        });
        logger.info(`[Voice] Tool filler enqueued for: ${toolName}`, 'cyan');
      }
    };

    // 5. Streaming TTS: synthesize each sentence as soon as LLM emits it
    let voiceEmotion: import('../voicepeak/client.js').VoicepeakEmotion | undefined;
    let streamedSentenceCount = 0;
    const ttsStartTime = Date.now();

    const onEmotionResolved = (emotion: EmotionType | null) => {
      if (emotion?.parameters) {
        voiceEmotion = this.voicepeakClient.mapPlutchikToVoicepeak(emotion.parameters as unknown as Record<string, number>);
        logger.info(`[Voice] Emotion resolved for streaming TTS: ${emotion.emotion} -> happy=${voiceEmotion.happy} fun=${voiceEmotion.fun} angry=${voiceEmotion.angry} sad=${voiceEmotion.sad}`, 'cyan');
      }
    };

    const onStreamSentence = async (sentence: string) => {
      if (streamedSentenceCount === 0) {
        this.publishVoiceStatus(memoryZone, message.guildId, 'tts');
      }
      try {
        this.eventBus.publish({
          type: 'discord:voice_stream_text',
          memoryZone,
          data: { guildId: message.guildId, channelId: message.channelId, sentence } as DiscordVoiceStreamTextInput,
        });
        const wavBuf = await this.voicepeakClient.synthesize(sentence, { emotion: voiceEmotion });
        this.eventBus.publish({
          type: 'discord:voice_enqueue',
          memoryZone,
          data: { guildId: message.guildId, audioBuffer: wavBuf } as DiscordVoiceEnqueueInput,
        });
        streamedSentenceCount++;
        logger.info(`[Voice] Streamed sentence #${streamedSentenceCount} TTS enqueued: "${sentence.substring(0, 40)}..."`, 'cyan');
      } catch (err) {
        logger.error(`[Voice] Streaming TTS failed for sentence: "${sentence.substring(0, 40)}..."`, err);
      }
    };

    // Build envelope via ChannelAdapter (voice variant)
    const voiceEnvelope = discordAdapter.toEnvelope({
      text: userMessageForLlm,
      type: 'voice',
      guildName: message.guildName,
      channelId: message.channelId,
      guildId: message.guildId,
      channelName: message.channelName,
      userName: message.userName,
      messageId: '',
      userId: message.userId,
      recentMessages: message.recentMessages as unknown[],
      isVoiceChannel: true,
    } as DiscordNativeEvent);
    // Inject voice-specific metadata
    voiceEnvelope.metadata = {
      ...voiceEnvelope.metadata,
      environmentState: infoMessage,
    };

    const graphResult = await this.invokeGraph(
      voiceEnvelope,
      message.recentMessages
        ? [...message.recentMessages, new HumanMessage(userMessageForLlm)]
        : [],
    );
    const emotion = graphResult.emotion ?? null;
    const responseText = await responsePromise;
    const llmMs = Date.now() - llmStartTime;
    voiceResponseChannelIds.delete(message.channelId);

    if (!responseText) {
      logger.warn('[LLM] No response text for voice message');
      this.eventBus.publish({
        type: 'discord:voice_queue_end',
        memoryZone,
        data: { guildId: message.guildId, channelId: message.channelId, text: '' } as DiscordVoiceQueueEndInput,
      });
      return;
    }

    // 6. Fallback: if streaming didn't emit any sentences, use batch TTS
    if (streamedSentenceCount === 0) {
      if (!voiceEmotion && emotion?.parameters) {
        voiceEmotion = this.voicepeakClient.mapPlutchikToVoicepeak(emotion.parameters as unknown as Record<string, number>);
      }
      this.publishVoiceStatus(memoryZone, message.guildId, 'tts');
      try {
        const sentences = splitIntoSentences(responseText);
        logger.info(`[Voice] Fallback: batch TTS for ${sentences.length} sentence(s)`, 'cyan');
        for (const s of sentences) {
          const wavBuf = await this.voicepeakClient.synthesize(s, { emotion: voiceEmotion });
          this.eventBus.publish({
            type: 'discord:voice_enqueue',
            memoryZone,
            data: { guildId: message.guildId, audioBuffer: wavBuf } as DiscordVoiceEnqueueInput,
          });
        }
      } catch (error) {
        logger.error('[Voice] Fallback batch TTS failed:', error);
      }
    }

    const ttsMs = Date.now() - ttsStartTime;
    const totalMs = Date.now() - voiceStartTime;
    logger.info(
      `[Voice] STT: ${sttMs}ms | LLM: ${llmMs}ms | TTS: ${ttsMs}ms (${streamedSentenceCount} streamed) | Total: ${totalMs}ms`,
      'cyan'
    );

    // 7. Signal queue completion with full text for Discord post
    this.eventBus.publish({
      type: 'discord:voice_queue_end',
      memoryZone,
      data: {
        guildId: message.guildId,
        channelId: message.channelId,
        text: responseText,
      } as DiscordVoiceQueueEndInput,
    });
  }

  private async processMinebotVoiceResponse(data: MinebotVoiceResponseOutput) {
    const { guildId, channelId, responseText } = data;
    if (!responseText) {
      logger.warn('[Minebot Voice] Empty response text');
      this.eventBus.publish({
        type: 'discord:voice_queue_end',
        memoryZone: 'minebot' as any,
        data: { guildId, channelId, text: '' } as DiscordVoiceQueueEndInput,
      });
      return;
    }

    const memoryZone = (await getDiscordMemoryZone(guildId)) as any;
    logger.info(`[Minebot Voice] TTS for response: "${responseText.substring(0, 60)}..."`, 'magenta');
    this.publishVoiceStatus(memoryZone, guildId, 'tts', '🤖 Minebot TTS...');

    try {
      const emotion = await this.voicepeakClient.analyzeEmotionForTTS(responseText);
      const sentences = splitIntoSentences(responseText);
      for (const s of sentences) {
        const wavBuf = await this.voicepeakClient.synthesize(s, { emotion });
        this.eventBus.publish({
          type: 'discord:voice_enqueue',
          memoryZone,
          data: { guildId, audioBuffer: wavBuf } as DiscordVoiceEnqueueInput,
        });
      }
    } catch (error) {
      logger.error('[Minebot Voice] TTS failed:', error);
    }

    this.eventBus.publish({
      type: 'discord:voice_queue_end',
      memoryZone,
      data: { guildId, channelId, text: responseText } as DiscordVoiceQueueEndInput,
    });

    voiceResponseChannelIds.delete(channelId);
    logger.info(`[Minebot Voice] Response complete`, 'magenta');
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

  /**
   * Core graph invocation — the single entry point for all channels.
   *
   * All channel handlers build a RequestEnvelope via their ChannelAdapter,
   * then call this method. No more manual TaskContext construction.
   */
  async invokeGraph(
    envelope: RequestEnvelope,
    legacyMessages?: BaseMessage[],
    options?: {
      onToolStarting?: (toolName: string, args?: Record<string, unknown>) => void;
      onTaskTreeUpdate?: (taskTree: import('@shannon/common').TaskTreeState) => void;
    },
  ): Promise<ShannonGraphState> {
    await this.initialize();
    if (!this.shannonGraph) {
      throw new Error('Shannon graph not initialized');
    }

    try {
      return await this.executionCoordinator.run(envelope, async () => {
        const result = await invokeShannonGraph(this.shannonGraph!, envelope, legacyMessages, options);
        await this.dispatchActionPlan(envelope, result);
        return result;
      });
    } catch (error) {
      const zone = envelope.metadata?.legacyMemoryZone ?? envelope.channel;
      logger.error(`Graph invocation error [${zone}]:`, error);
      this.eventBus.log(zone as any, 'red', `Error: ${error}`, true);
      throw error;
    }
  }

  private async dispatchActionPlan(
    envelope: RequestEnvelope,
    result: ShannonGraphState,
  ): Promise<void> {
    if (!result.actionPlan) return;
    const dispatcher = getActionDispatcher(envelope.channel);
    if (!dispatcher) return;
    await dispatcher.dispatch(envelope, result.actionPlan);
  }

  public async registerMinebotTools(bot: import('../minebot/types.js').CustomBot): Promise<void> {
    await this.initialize();
    if (!this.unifiedFca) return;
    const { InstantSkillTool } = await import('../minebot/skills/InstantSkillTool.js');
    const tools = bot.instantSkills
      .getSkills()
      .filter((skill) => skill.isToolForLLM)
      .map((skill) => new InstantSkillTool(skill, bot));
    this.unifiedFca.addTools(tools);
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

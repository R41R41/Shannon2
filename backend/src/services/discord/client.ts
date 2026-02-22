import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import {
  DiscordClientInput,
  DiscordGetServerEmojiInput,
  DiscordGetServerEmojiOutput,
  DiscordPlanningInput,
  DiscordScheduledPostInput,
  DiscordSendServerEmojiInput,
  DiscordSendServerEmojiOutput,
  DiscordSendTextMessageInput,
  DiscordSendTextMessageOutput,
  DiscordVoiceEnqueueInput,
  DiscordVoiceFillerInput,
  DiscordVoiceMessageOutput,
  DiscordVoiceQueueEndInput,
  DiscordVoiceQueueStartInput,
  DiscordVoiceResponseInput,
  DiscordVoiceStatusInput,
  MinebotInput,
  MinecraftServerName,
  ServiceInput,
  YoutubeSubscriberUpdateOutput,
} from '@shannon/common';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  ComponentType,
  EmbedBuilder,
  GatewayIntentBits,
  GuildMember,
  Partials,
  SlashCommandBuilder,
  TextChannel,
  ThreadChannel,
  User,
  VoiceChannel,
} from 'discord.js';
import {
  AudioPlayer,
  AudioPlayerStatus,
  EndBehaviorType,
  VoiceConnection,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  getVoiceConnection,
  joinVoiceChannel,
} from '@discordjs/voice';
import OpusPackage from '@discordjs/opus';
const { OpusEncoder } = OpusPackage;
import { Readable } from 'stream';
import fs from 'fs';
import * as Jimp from 'jimp';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../../config/env.js';
import { getDiscordMemoryZone } from '../../utils/discord.js';
import { logger } from '../../utils/logger.js';
import { voiceResponseChannelIds } from './voiceState.js';
import { loadFillers, generateAllFillers } from './voiceFiller.js';
import { BaseClient } from '../common/BaseClient.js';
import { getEventBus } from '../eventBus/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type VoteState = {
  [userId: string]: number | null; // userId -> index of voted option
};

const voteDurations: { [key: string]: number } = {
  '1m': 60 * 1000,
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
};
/**
 * Discord の 2000 文字制限に対応してメッセージを分割する
 * 改行位置で自然に区切る
 */
function splitDiscordMessage(text: string, maxLength = 2000): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    // 改行で区切れる位置を探す
    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt <= 0) {
      // 改行がなければスペースで
      splitAt = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitAt <= 0) {
      // それでもなければ強制分割
      splitAt = maxLength;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, '');
  }
  return chunks;
}

/**
 * テキストチャンネルに分割送信する
 */
async function sendLongMessage(
  channel: { send: (content: string) => Promise<unknown> },
  text: string
): Promise<void> {
  const chunks = splitDiscordMessage(text);
  for (const chunk of chunks) {
    await channel.send(chunk);
  }
}

export class DiscordBot extends BaseClient {
  private client: Client;
  private toyamaGuildId: string | null = null;
  private toyamaChannelId: string | null = null;
  private aiminelabGuildId: string | null = null;
  private aiminelabXChannelId: string | null = null;
  private aiminelabAnnounceChannelId: string | null = null;
  private aiminelabUpdateChannelId: string | null = null;
  private testGuildId: string | null = null;
  private testXChannelId: string | null = null;
  private doukiGuildId: string | null = null;
  private doukiChannelId: string | null = null;
  private colabGuildId: string | null = null;
  private colabChannelId: string | null = null;
  private static instance: DiscordBot;
  public isDev: boolean = false;
  private voiceConnections: Map<string, VoiceConnection> = new Map();
  private audioPlayers: Map<string, AudioPlayer> = new Map();
  private userAudioBuffers: Map<string, Buffer[]> = new Map();
  private userSpeakingTimers: Map<string, NodeJS.Timeout> = new Map();
  private voiceProcessingLock: Map<string, boolean> = new Map();
  private activeVoiceUsers: Map<string, string | null> = new Map(); // guildId -> userId or null
  private voiceTextChannelIds: Map<string, string> = new Map(); // guildId -> textChannelId
  private voiceQueues: Map<string, {
    buffers: Buffer[];
    done: boolean;
    notify: (() => void) | null;
    channelId: string;
    text: string;
  }> = new Map();
  private voicePttMessages: Map<string, { channelId: string; messageId: string }> = new Map(); // guildId -> PTT message
  public static getInstance(isDev?: boolean) {
    if (!DiscordBot.instance) {
      DiscordBot.instance = new DiscordBot('discord', isDev ?? false);
    }
    // isDev は初期化時にのみ設定。以降の呼び出しでは上書きしない
    if (isDev !== undefined) {
      DiscordBot.instance.isDev = isDev;
    }
    return DiscordBot.instance;
  }

  private constructor(serviceName: 'discord', isDev: boolean = false) {
    const eventBus = getEventBus();
    super(serviceName, eventBus);
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildModeration,
      ],
      partials: [
        Partials.Channel,
        Partials.Message,
        Partials.ThreadMember,
      ],
    });
    this.eventBus = eventBus;

    this.client.once('ready', async () => {
      this.setupSlashCommands();
      loadFillers().catch(err => logger.warn(`[Discord] Filler loading failed: ${err}`));

      // 既存のアクティブスレッドに参加
      for (const [, guild] of this.client.guilds.cache) {
        try {
          const threads = await guild.channels.fetchActiveThreads();
          for (const [, thread] of threads.threads) {
            if (thread.joinable && !thread.joined) {
              await thread.join();
              logger.info(`[Discord] 既存スレッドに参加: ${thread.name}`);
            }
          }
        } catch (err) {
          logger.warn(`[Discord] ${guild.name} のスレッド取得失敗: ${err}`);
        }
      }
    });

    this.setUpChannels();
    this.setupEventHandlers();
  }

  private setUpChannels() {
    this.toyamaGuildId = config.discord.guilds.toyama.guildId;
    this.doukiGuildId = config.discord.guilds.douki.guildId;
    this.colabGuildId = config.discord.guilds.colab.guildId;
    this.toyamaChannelId = config.discord.guilds.toyama.channelId;
    this.doukiChannelId = config.discord.guilds.douki.channelId;
    this.colabChannelId = config.discord.guilds.colab.channelId;
    this.aiminelabGuildId = config.discord.guilds.aimine.guildId;
    this.aiminelabXChannelId = config.discord.guilds.aimine.xChannelId;
    this.aiminelabAnnounceChannelId =
      config.discord.guilds.aimine.announceChannelId;
    this.aiminelabUpdateChannelId =
      config.discord.guilds.aimine.updateChannelId;
    this.testGuildId = config.discord.guilds.test.guildId;
    this.testXChannelId = config.discord.guilds.test.xChannelId;
  }

  public initialize() {
    try {
      this.client.login(config.discord.token);
      logger.info('Discord bot started', 'blue');
    } catch (error) {
      logger.error('Discord bot failed to start');
      this.eventBus.log(
        'discord:aiminelab_server',
        'red',
        `Discord bot failed to start: ${error}`
      );
    }
  }

  private async setupSlashCommands() {
    try {
      const serverChoices = [
        { name: 'YouTube配信用', value: '1.21.4-fabric-youtube' },
        { name: 'テスト用', value: '1.21.4-test' },
        { name: 'プレイ用', value: '1.21.1-play' },
      ];

      const commands = [
        new SlashCommandBuilder()
          .setName('minecraft_server_status')
          .setDescription('Minecraftサーバーの状態を取得する')
          .addStringOption((option) =>
            option
              .setName('server_name')
              .setDescription('サーバー名')
              .setRequired(true)
              .addChoices(...serverChoices)
          ),
        new SlashCommandBuilder()
          .setName('minecraft_server_start')
          .setDescription('Minecraftサーバーを起動する')
          .addStringOption((option) =>
            option
              .setName('server_name')
              .setDescription('サーバー名')
              .setRequired(true)
              .addChoices(...serverChoices)
          ),
        new SlashCommandBuilder()
          .setName('minecraft_server_stop')
          .setDescription('Minecraftサーバーを停止する')
          .addStringOption((option) =>
            option
              .setName('server_name')
              .setDescription('サーバー名')
              .setRequired(true)
              .addChoices(...serverChoices)
          ),
        new SlashCommandBuilder()
          .setName('minebot_login')
          .setDescription('MinebotをMinecraftサーバーにログインさせる')
          .addStringOption((option) =>
            option
              .setName('server_name')
              .setDescription('サーバー名')
              .setRequired(true)
              .addChoices(...serverChoices)
          ),
        new SlashCommandBuilder()
          .setName('minebot_logout')
          .setDescription('MinebotをMinecraftサーバーからログアウトさせる'),
        new SlashCommandBuilder()
          .setName('vote')
          .setDescription('投票を開始します')
          .addStringOption(option =>
            option
              .setName('description')
              .setDescription('投票の説明')
              .setRequired(true)
          )
          .addStringOption(option =>
            option
              .setName('options')
              .setDescription('カンマ区切りの投票候補（例: 選択肢A,選択肢B,選択肢C）')
              .setRequired(true)
          )
          .addStringOption(option =>
            option
              .setName('duration')
              .setDescription('投票期間')
              .setRequired(true)
              .addChoices(
                { name: '1分', value: '1m' },
                { name: '1時間', value: '1h' },
                { name: '1日', value: '1d' },
                { name: '1週間', value: '1w' }
              )
          )
          .addIntegerOption(option =>
            option
              .setName('max_votes')
              .setDescription('1人あたりの最大投票数')
              .setRequired(true)
          ),
        new SlashCommandBuilder()
          .setName('dice')
          .setDescription('6面ダイスをn個振って出目を表示します')
          .addIntegerOption(option =>
            option
              .setName('count')
              .setDescription('振るダイスの個数（1~10）')
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(10)
          ),
        new SlashCommandBuilder()
          .setName('voice_join')
          .setDescription('シャノンをボイスチャンネルに参加させる'),
        new SlashCommandBuilder()
          .setName('voice_leave')
          .setDescription('シャノンをボイスチャンネルから退出させる'),
        new SlashCommandBuilder()
          .setName('generate_fillers')
          .setDescription('フィラー音声を生成する（初回のみ必要）'),
      ];

      // コマンドをJSON形式に変換
      const commandsJson = commands.map((command) => command.toJSON());

      // コマンドを特定のギルドに登録（即時反映）
      const targetGuildId = this.isDev
        ? config.discord.guilds.test.guildId
        : config.discord.guilds.aimine.guildId;

      if (targetGuildId) {
        const guild = this.client.guilds.cache.get(targetGuildId);
        if (guild) {
          await guild.commands.set(commandsJson);
          logger.success(`Slash commands registered to guild: ${guild.name}`);
        } else {
          logger.warn(`Guild ${targetGuildId} not found, falling back to global`);
          if (this.client.application) {
            await this.client.application.commands.set(commandsJson);
            logger.success('Slash commands registered globally');
          }
        }
      } else if (this.client.application) {
        await this.client.application.commands.set(commandsJson);
        logger.success('Slash commands registered globally');
      }

      this.client.on('interactionCreate', async (interaction) => {
        if (interaction.isButton() && interaction.customId === 'voice_ptt') {
          await this.handleVoicePttButton(interaction);
          return;
        }
        if (interaction.isButton() && interaction.customId === 'voice_generate_response') {
          await this.handleVoiceGenerateResponse(interaction);
          return;
        }

        if (!interaction.isCommand()) return;

        switch (interaction.commandName) {
          case 'minecraft_server_status':
            if (interaction.isChatInputCommand()) {
              const serverName: MinecraftServerName =
                interaction.options.getString(
                  'server_name',
                  true
                ) as MinecraftServerName;
              await interaction.deferReply();
              try {
                // ステータス取得のためにリスナーを設定
                const statusPromise = new Promise<string>((resolve) => {
                  const unsubscribe = this.eventBus.subscribe('web:status', (event) => {
                    const data = event.data as { service: string; status: string };
                    if (data.service === `minecraft:${serverName}`) {
                      unsubscribe();
                      resolve(data.status);
                    }
                  });
                  // 10秒でタイムアウト
                  setTimeout(() => {
                    unsubscribe();
                    resolve('timeout');
                  }, 10000);
                });

                this.eventBus.publish({
                  type: `minecraft:${serverName}:status`,
                  memoryZone: 'minecraft',
                  data: { serviceCommand: 'status' } as ServiceInput,
                });

                const status = await statusPromise;
                const statusEmoji = status === 'running' ? '🟢' : status === 'stopped' ? '🔴' : '⚪';
                await interaction.editReply(`${statusEmoji} **${serverName}**: ${status}`);
              } catch (error) {
                await interaction.editReply('ステータスの取得に失敗しました。');
                logger.error('Status error:', error);
              }
            }
            break;

          case 'minecraft_server_start':
            if (interaction.isChatInputCommand()) {
              const serverName: MinecraftServerName =
                interaction.options.getString(
                  'server_name',
                  true
                ) as MinecraftServerName;
              await interaction.deferReply();
              try {
                // ステータス取得のためにリスナーを設定
                const statusPromise = new Promise<string>((resolve) => {
                  const unsubscribe = this.eventBus.subscribe('web:status', (event) => {
                    const data = event.data as { service: string; status: string };
                    if (data.service === `minecraft:${serverName}`) {
                      unsubscribe();
                      resolve(data.status);
                    }
                  });
                  // 30秒でタイムアウト（起動に時間がかかる）
                  setTimeout(() => {
                    unsubscribe();
                    resolve('timeout');
                  }, 30000);
                });

                this.eventBus.publish({
                  type: `minecraft:${serverName}:status`,
                  memoryZone: 'minecraft',
                  data: { serviceCommand: 'start' } as ServiceInput,
                });

                const status = await statusPromise;
                if (status === 'running') {
                  await interaction.editReply(`🟢 **${serverName}** を起動しました！`);
                } else if (status === 'timeout') {
                  await interaction.editReply(`⏰ **${serverName}** の起動がタイムアウトしました。`);
                } else {
                  await interaction.editReply(`⚠️ **${serverName}** の起動に問題が発生しました。ステータス: ${status}`);
                }
              } catch (error) {
                await interaction.editReply('サーバーの起動に失敗しました。');
                logger.error('Start error:', error);
              }
            }
            break;

          case 'minecraft_server_stop':
            if (interaction.isChatInputCommand()) {
              const serverName: MinecraftServerName =
                interaction.options.getString(
                  'server_name',
                  true
                ) as MinecraftServerName;
              await interaction.deferReply();
              try {
                // 停止開始を通知
                await interaction.editReply(`⏳ **${serverName}** を停止中...\n（ワールド保存に時間がかかる場合があります）`);

                // ステータス取得のためにリスナーを設定
                const statusPromise = new Promise<string>((resolve) => {
                  const unsubscribe = this.eventBus.subscribe('web:status', (event) => {
                    const data = event.data as { service: string; status: string };
                    if (data.service === `minecraft:${serverName}`) {
                      unsubscribe();
                      resolve(data.status);
                    }
                  });
                  // 90秒でタイムアウト（ワールド保存に時間がかかる）
                  setTimeout(() => {
                    unsubscribe();
                    resolve('timeout');
                  }, 90000);
                });

                this.eventBus.publish({
                  type: `minecraft:${serverName}:status`,
                  memoryZone: 'minecraft',
                  data: { serviceCommand: 'stop' } as ServiceInput,
                });

                const status = await statusPromise;
                if (status === 'stopped') {
                  await interaction.editReply(`🔴 **${serverName}** を停止しました！`);
                } else if (status === 'timeout') {
                  await interaction.editReply(`⏰ **${serverName}** の停止がタイムアウトしました。`);
                } else {
                  await interaction.editReply(`⚠️ **${serverName}** の停止に問題が発生しました。ステータス: ${status}`);
                }
              } catch (error) {
                await interaction.editReply('サーバーの停止に失敗しました。');
                logger.error('Stop error:', error);
              }
            }
            break;

          case 'minebot_login':
            if (interaction.isChatInputCommand()) {
              const serverName: MinecraftServerName =
                interaction.options.getString(
                  'server_name',
                  true
                ) as MinecraftServerName;
              await interaction.deferReply();
              try {
                // spawn イベントを待つ（実際にログイン完了まで）
                const spawnPromise = new Promise<{ success: boolean; message?: string }>((resolve) => {
                  // spawnイベントのリスナー
                  const unsubscribeSpawn = this.eventBus.subscribe('minebot:spawned', () => {
                    unsubscribeSpawn();
                    resolve({ success: true });
                  });
                  // エラーイベントのリスナー
                  const unsubscribeError = this.eventBus.subscribe('minebot:error', (event) => {
                    unsubscribeError();
                    resolve({ success: false, message: (event.data as { message?: string })?.message });
                  });
                  // 120秒でタイムアウト（Microsoft認証に時間がかかる場合）
                  setTimeout(() => {
                    unsubscribeSpawn();
                    unsubscribeError();
                    resolve({ success: false, message: 'timeout' });
                  }, 120000);
                });

                // ログイン開始を通知
                await interaction.editReply(`⏳ Minebotを **${serverName}** にログイン中...\n（Microsoft認証が必要な場合、コンソールでコードを確認してください）`);

                this.eventBus.publish({
                  type: 'minebot:bot:status',
                  memoryZone: 'minebot',
                  data: { serviceCommand: 'start', serverName } as MinebotInput,
                });

                const result = await spawnPromise;
                if (result.success) {
                  await interaction.editReply(`🤖 Minebotが **${serverName}** にログインしました！`);
                } else if (result.message === 'timeout') {
                  await interaction.editReply(`⏰ Minebotのログインがタイムアウトしました（120秒）。\nMicrosoft認証が必要な場合はコンソールを確認してください。`);
                } else {
                  await interaction.editReply(`⚠️ Minebotのログインに失敗しました: ${result.message}`);
                }
              } catch (error) {
                await interaction.editReply('Minebotのログインに失敗しました。');
                logger.error('Minebot login error:', error);
              }
            }
            break;

          case 'minebot_logout':
            if (interaction.isChatInputCommand()) {
              await interaction.deferReply();
              try {
                // 完了イベントを待つ
                const logoutPromise = new Promise<{ success: boolean; message?: string }>((resolve) => {
                  const unsubscribe = this.eventBus.subscribe('minebot:stopped', () => {
                    unsubscribe();
                    resolve({ success: true });
                  });
                  // 30秒でタイムアウト
                  setTimeout(() => {
                    unsubscribe();
                    resolve({ success: false, message: 'timeout' });
                  }, 30000);
                });

                this.eventBus.publish({
                  type: 'minebot:bot:status',
                  memoryZone: 'minebot',
                  data: { serviceCommand: 'stop' } as MinebotInput,
                });

                const result = await logoutPromise;
                if (result.success) {
                  await interaction.editReply(`👋 Minebotがログアウトしました！`);
                } else if (result.message === 'timeout') {
                  await interaction.editReply(`⏰ Minebotのログアウトがタイムアウトしました。`);
                } else {
                  await interaction.editReply(`⚠️ Minebotのログアウトに問題が発生しました: ${result.message}`);
                }
              } catch (error) {
                await interaction.editReply('Minebotのログアウトに失敗しました。');
                logger.error('Minebot logout error:', error);
              }
            }
            break;

          case 'vote':
            if (interaction.isChatInputCommand()) {
              const description = interaction.options.getString('description', true);
              const options = interaction.options.getString('options', true);
              const duration = interaction.options.getString('duration', true);
              const maxVotes = interaction.options.getInteger('max_votes', true);
              await this.sendVoteMessage(interaction, description, options, duration, maxVotes);
            }
            break;
          case 'dice':
            if (interaction.isChatInputCommand()) {
              const count = interaction.options.getInteger('count', true);
              await this.sendDiceMessage(interaction, count);
            }
            break;

          case 'voice_join':
            if (interaction.isChatInputCommand()) {
              await this.handleVoiceJoin(interaction);
            }
            break;

          case 'voice_leave':
            if (interaction.isChatInputCommand()) {
              await this.handleVoiceLeave(interaction);
            }
            break;

          case 'generate_fillers':
            if (interaction.isChatInputCommand()) {
              await interaction.deferReply({ flags: 64 });
              const count = await generateAllFillers();
              await interaction.editReply(`フィラー音声を ${count} 個生成しました。`);
            }
            break;
        }
      });
      logger.success('Slash command setup completed');
    } catch (error) {
      logger.error(`Slash command setup error: ${error}`);
    }
  }

  private async sendDiceMessage(interaction: ChatInputCommandInteraction, count: number) {
    if (count < 1 || count > 10) {
      await interaction.reply('ダイスの個数は1~10で指定してください。');
      return;
    }
    // ダイスを振る
    const results = Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1);

    const diceSize = 32; // 1個あたりのサイズ（px）
    const canvasSize = diceSize * 1.5;

    const diceImages = await Promise.all(results.map(async (num) => {
      // 1. 画像読み込み
      let img = await Jimp.Jimp.read(path.join(__dirname, '../../../saves/images/dice/', `dice_${num}.png`));
      // 2. リサイズ
      const img2 = img.resize({ w: diceSize, h: diceSize });
      // 3. 回転
      const angle = Math.floor(Math.random() * 360);
      const img3 = img2.rotate(angle);

      // 4. はみ出し防止: 新しいキャンバスに中央配置
      const canvas = new Jimp.Jimp({ width: canvasSize, height: canvasSize, color: 0x00000000 });
      const x = (canvasSize - img3.bitmap.width) / 2;
      const y = (canvasSize - img3.bitmap.height) / 2;
      canvas.composite(img3, x, y);

      return canvas;
    }));

    // 横に結合
    const resultImage = new Jimp.Jimp({ width: canvasSize * count, height: canvasSize, color: 0x00000000 });
    diceImages.forEach((img, i) => {
      resultImage.composite(img, i * canvasSize, 0);
    });

    // 一時ファイルとして保存
    const filePath = path.join(__dirname, '../../../saves/images/dice', `dice_result_${Date.now()}.png`);
    await resultImage.write(filePath as `${string}.${string}`);
    interaction.reply({
      content: `🎲 ${count}個の6面ダイスを振った結果（合計: ${results.reduce((a, b) => a + b, 0)}）`,
      files: [filePath]
    });
    // 2秒後に一時ファイルを削除
    await new Promise(resolve => setTimeout(resolve, 2000));
    fs.unlinkSync(filePath);
    logger.info("ファイル削除");
  }

  /**
 * 投票メッセージを送信する関数
 * @param interaction DiscordのスラッシュコマンドなどのInteraction
 * @param options カンマ区切りの投票候補（例: "選択肢A,選択肢B,選択肢C"）
 * @param duration 投票期間（'1m', '1h', '1d', '1w' のいずれか）
 */
  private async sendVoteMessage(
    interaction: ChatInputCommandInteraction,
    description: string,
    options: string,
    duration: string,
    maxVotes: number
  ) {
    const optionList = options.split(',').map(opt => opt.trim());
    const voteId = `vote_${Date.now()}`;
    const voteState: { [userId: string]: number[] } = {};
    const voteCounts: number[] = Array(optionList.length).fill(0);

    const components = optionList.map((option, index) => {
      const customId = `${voteId}_option_${index}`;
      return new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(`0票 | ${option}`)
        .setStyle(ButtonStyle.Secondary);
    });

    // ボタンを5個ずつのActionRowにまとめる
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    for (let i = 0; i < components.length; i += 5) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...components.slice(i, i + 5)));
    }

    const embed = new EmbedBuilder()
      .setTitle('📊 投票を開始します！')
      .setDescription(description + '\n' + '一人あたり' + maxVotes + '票まで投票できます。')
      .setColor(0x00ae86)
      .setFooter({ text: `投票終了まで: ${duration}` });

    const message = await interaction.reply({
      embeds: [embed],
      components: rows,
      fetchReply: true,
    });

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: voteDurations[duration] ?? voteDurations['1h'],
    });

    collector.on('collect', async i => {
      const userId = i.user.id;
      const pressedIndex = parseInt(i.customId.split('_').pop() || '0', 10);
      if (!voteState[userId]) voteState[userId] = [];

      // 既にこの候補に投票している場合は投票解除
      if (voteState[userId].includes(pressedIndex)) {
        voteState[userId] = voteState[userId].filter(idx => idx !== pressedIndex);
        voteCounts[pressedIndex]--;
      } else {
        // まだ投票していなくて、最大票数未満なら投票追加
        if (voteState[userId].length < maxVotes) {
          voteState[userId].push(pressedIndex);
          voteCounts[pressedIndex]++;
        } else {
          // 最大票数に達している場合は何もしない or メッセージ
          await i.reply({ content: `あなたは最大${maxVotes}票まで投票できます。`, ephemeral: true });
          return;
        }
      }

      // ボタンの状態更新
      const newComponents = optionList.map((option, index) => {
        const customId = `${voteId}_option_${index}`;
        const isVoted = voteState[userId].includes(index);
        return new ButtonBuilder()
          .setCustomId(customId)
          .setLabel(`${voteCounts[index]}票 | ${option}`)
          .setStyle(isVoted ? ButtonStyle.Success : ButtonStyle.Secondary);
      });

      // ボタンを5個ずつのActionRowにまとめる
      const newRows: ActionRowBuilder<ButtonBuilder>[] = [];
      for (let i = 0; i < newComponents.length; i += 5) {
        newRows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...newComponents.slice(i, i + 5)));
      }

      await i.update({ components: newRows });
    });

    collector.on('end', async () => {
      const results = optionList
        .map((option, index) => `- ${option}: ${voteCounts[index]}票`)
        .join('\n');

      const resultEmbed = new EmbedBuilder()
        .setTitle('📊 投票結果')
        .setDescription(results)
        .setColor(0x00ae86);

      await message.edit({ embeds: [resultEmbed], components: [] });
    });
  }

  private getUserNickname(user: User, guildId?: string) {
    // ギルドIDが指定されていて、そのギルドのメンバーが取得できる場合
    if (guildId) {
      const guild = this.client.guilds.cache.get(guildId);
      if (guild) {
        const member = guild.members.cache.get(user.id);
        if (member && member.nickname) {
          return member.nickname;
        }
      }
    }

    // ギルドのニックネームがない場合はグローバル表示名を使用
    if (user.displayName) {
      return user.displayName;
    }

    // どちらもない場合はユーザー名を使用
    return user.username;
  }

  private getChannelName(channelId: string) {
    const channel = this.client.channels.cache.get(channelId);
    if (channel instanceof TextChannel) {
      return channel.name;
    }
    if (channel instanceof ThreadChannel) {
      return `${channel.parent?.name ?? 'unknown'}/${channel.name}`;
    }
    return channelId;
  }

  private getGuildName(channelId: string) {
    const channel = this.client.channels.cache.get(channelId);
    if (channel && 'guild' in channel) {
      return channel.guild.name;
    }
    return channelId;
  }

  private setupEventHandlers() {
    this.eventBus.subscribe('discord:status', async (event) => {
      const { serviceCommand } = event.data as DiscordClientInput;
      if (serviceCommand === 'start') {
        await this.start();
      } else if (serviceCommand === 'stop') {
        await this.stop();
      } else if (serviceCommand === 'status') {
        this.eventBus.publish({
          type: 'web:status',
          memoryZone: 'web',
          data: {
            service: 'discord',
            status: this.status,
          },
        });
      }
    });
    // スレッドが作成されたら自動参加（メッセージ受信のため）
    this.client.on('threadCreate', async (thread) => {
      if (!thread.joinable) return;
      try {
        await thread.join();
        logger.info(`[Discord] スレッドに参加: ${thread.name} (${thread.id})`);
      } catch (err) {
        logger.warn(`[Discord] スレッド参加失敗: ${thread.name}: ${err}`);
      }
    });

    this.client.on('messageCreate', async (message) => {
      try {
      // 全メッセージのデバッグログ（スレッド問題調査用）
      const isThread = message.channel?.isThread?.();
      if (isThread) {
        logger.info(`[Discord] スレッド内メッセージ受信: ch=${message.channelId} author=${message.author?.username} content="${message.content?.substring(0, 50)}"`);
      }

      if (this.status !== 'running') {
        if (isThread) logger.info(`[Discord] スレッドメッセージスキップ: status=${this.status}`);
        return;
      }
      // Partial メッセージの場合はfetchして完全なデータを取得
      if (message.partial) {
        try {
          message = await message.fetch();
        } catch (err) {
          logger.warn(`[Discord] Partial メッセージのfetch失敗: ${err}`);
          return;
        }
      }
      const isDevGuild = message.guildId === config.discord.guilds.test.guildId;
      if (this.isDev !== isDevGuild) {
        if (isThread) logger.info(`[Discord] スレッドメッセージスキップ: isDev=${this.isDev} isDevGuild=${isDevGuild}`);
        return;
      }

      logger.info(message.content);

      if (message.author.bot) return;
      const mentions = message.mentions.users.map((user) => ({
        nickname: this.getUserNickname(user, message.guildId ?? ''),
        id: user.id,
        isBot: user.bot,
      }));

      // mentionに自分が含まれているかどうかを確認
      const isMentioned = mentions.some(
        (mention) => mention.id === this.client.user?.id
      );
      if (mentions.length > 0 && !isMentioned) {
        if (isThread) logger.info(`[Discord] スレッドメッセージスキップ: 他ユーザーへのメンション`);
        return;
      }

      if (message.channelId === this.aiminelabUpdateChannelId) return;

      // アイマイラボ！サーバーではメンション時のみ返信
      if (message.guildId === this.aiminelabGuildId && !isMentioned) return;

      const messageContent = message.content.replace(
        /<@!?(\d+)>/g,
        (match, id) => {
          const mentionedUser = mentions.find((user) => user.id === id);
          return mentionedUser ? `@${mentionedUser.nickname}` : match;
        }
      );
      const nickname = this.getUserNickname(
        message.author,
        message.guildId ?? ''
      );
      const channelName = this.getChannelName(message.channelId);
      const guildName = this.getGuildName(message.channelId);
      const memoryZone = await getDiscordMemoryZone(message.guildId ?? '');
      const messageId = message.id;
      const userId = message.author.id;
      const guildId = message.guildId;
      const recentMessages = await this.getRecentMessages(message.channelId);

      // 画像URLを取得
      const imageUrls = message.attachments
        .filter((attachment) => attachment.contentType?.startsWith('image/'))
        .map((attachment) => attachment.url);

      // 返信先メッセージの画像URLを取得
      let replyContext = '';
      if (message.reference?.messageId) {
        try {
          const refMsg = await message.fetchReference();
          const refNickname = this.getUserNickname(refMsg.author, refMsg.guildId ?? '');
          const refImageUrls = refMsg.attachments
            .filter((att) => att.contentType?.startsWith('image/'))
            .map((att) => att.url);
          const refEmbedImages = refMsg.embeds
            .filter((e) => e.image?.url)
            .map((e) => e.image!.url);
          const allRefImages = [...refImageUrls, ...refEmbedImages];

          replyContext = `[返信先: ${refNickname}「${refMsg.content?.substring(0, 100) || ''}」`;
          if (allRefImages.length > 0) {
            replyContext += `\n返信先の画像: ${allRefImages.join('\n')}`;
          }
          replyContext += ']\n';
        } catch (err) {
          logger.warn(`[Discord] 返信先メッセージの取得に失敗: ${err}`);
        }
      }

      // スレッドの場合、スレッドの元投稿（スターターメッセージ）の画像をコンテキストに含める
      let threadStarterContext = '';
      const channelObj = this.client.channels.cache.get(message.channelId);
      if (channelObj instanceof ThreadChannel) {
        try {
          const starterMessage = await channelObj.fetchStarterMessage();
          if (starterMessage) {
            const starterImageUrls = starterMessage.attachments
              .filter((att) => att.contentType?.startsWith('image/'))
              .map((att) => att.url);
            const starterEmbedImages = starterMessage.embeds
              .filter((e) => e.image?.url)
              .map((e) => e.image!.url);
            const allStarterImages = [...starterImageUrls, ...starterEmbedImages];
            if (allStarterImages.length > 0) {
              const starterNickname = this.getUserNickname(starterMessage.author, starterMessage.guildId ?? '');
              threadStarterContext = `[スレッド元投稿: ${starterNickname}「${starterMessage.content?.substring(0, 100) || ''}」\nスレッド元投稿の画像: ${allStarterImages.join('\n')}]\n`;
            }
          }
        } catch (err) {
          logger.warn(`[Discord] スレッドスターターメッセージの取得に失敗: ${err}`);
        }
      }

      // テキストと画像URLを結合
      let contentWithImages = messageContent;
      if (imageUrls.length > 0) {
        contentWithImages += `\n画像: ${imageUrls.join('\n')}`;
      }
      if (replyContext) {
        contentWithImages = replyContext + contentWithImages;
      }
      if (threadStarterContext) {
        contentWithImages = threadStarterContext + contentWithImages;
      }

      // スレッドの場合は親チャンネルIDでフィルタリング
      const channel = this.client.channels.cache.get(message.channelId);
      const parentChannelId = (channel instanceof ThreadChannel)
        ? channel.parentId ?? message.channelId
        : message.channelId;

      if (
        guildId === this.toyamaGuildId &&
        parentChannelId !== this.toyamaChannelId
      )
        return;
      if (
        guildId === this.doukiGuildId &&
        parentChannelId !== this.doukiChannelId
      )
        return;
      if (
        guildId === this.colabGuildId &&
        parentChannelId !== this.colabChannelId
      )
        return;
      this.eventBus.log(
        memoryZone,
        'white',
        `${guildName} ${channelName}\n${nickname}: ${contentWithImages}`,
        true
      );
      logger.info(guildName + ' ' + channelName, 'blue');
      logger.info(nickname + ': ' + contentWithImages, 'blue');
      this.eventBus.publish({
        type: 'llm:get_discord_message',
        memoryZone: memoryZone,
        data: {
          text: contentWithImages,
          type: 'text',
          guildName: memoryZone,
          channelId: message.channelId,
          guildId: guildId,
          channelName: channelName,
          userName: nickname,
          messageId: messageId,
          userId: userId,
          recentMessages: recentMessages,
        } as DiscordSendTextMessageOutput,
      });
      } catch (err) {
        logger.error('[Discord] messageCreate ハンドラエラー:', err);
      }
    });
    this.client.on('speech', async (speech) => {
      if (this.status !== 'running') return;
      // テストモードの場合はテストサーバーのみ、それ以外の場合はテストサーバー以外を処理
      const channel = this.client.channels.cache.get(speech.channelId);
      if (!channel || !('guild' in channel)) return;

      const isDevGuild = channel.guild.id === config.discord.guilds.test.guildId;
      if (this.isDev !== isDevGuild) return;

      const memoryZone = await getDiscordMemoryZone(channel.guildId);

      const nickname = this.getUserNickname(speech.user, channel.guildId);
      this.eventBus.publish({
        type: 'llm:get_discord_message',
        memoryZone: memoryZone,
        data: {
          audio: speech.content,
          type: 'realtime_audio',
          channelId: speech.channelId,
          userName: nickname,
          guildId: channel.guild.id,
          guildName: channel.guild.name,
          channelName: channel.name,
          messageId: speech.messageId,
          userId: speech.userId,
        } as DiscordClientInput,
      });
    });

    // LLMからの応答を処理
    this.eventBus.subscribe('discord:post_message', async (event) => {
      if (this.status !== 'running') return;
      let { text, channelId, guildId, imageUrl } =
        event.data as DiscordSendTextMessageInput;

      if (voiceResponseChannelIds.has(channelId) && !text?.startsWith('🎤')) {
        logger.info(`[Discord] Voice processing active, skipping normal text post for channel ${channelId}`, 'yellow');
        return;
      }

      const channel = this.client.channels.cache.get(channelId);
      const channelName = this.getChannelName(channelId);
      const guildName = this.getGuildName(channelId);
      const memoryZone = await getDiscordMemoryZone(guildId);

      if (channel?.isTextBased() && 'send' in channel) {
        this.eventBus.log(
          memoryZone,
          'white',
          `${guildName} ${channelName}\nShannon: ${text}`,
          true
        );
        logger.info(guildName + ' ' + channelName, 'blue');
        logger.info('shannon: ' + text, 'blue');
        if (imageUrl) {
          const content = (text ?? '').slice(0, 2000);
          try {
            // ローカルファイルパスの場合はAttachmentBuilderで添付
            if (imageUrl.startsWith('/') || imageUrl.startsWith('./') || imageUrl.startsWith('../')) {
              if (fs.existsSync(imageUrl)) {
                const fileName = path.basename(imageUrl);
                const attachment = new AttachmentBuilder(imageUrl, { name: fileName });
                await channel.send({ content, files: [attachment] });
              } else {
                logger.warn(`[Discord] 画像ファイルが見つかりません: ${imageUrl}`);
                await channel.send({ content: content + '\n(画像ファイルが見つかりませんでした)' });
              }
            } else {
              // 外部URLの場合はembed
              const embed = { image: { url: imageUrl } };
              await channel.send({ content, embeds: [embed] });
            }
          } catch (imgError) {
            logger.error('[Discord] 画像送信エラー:', imgError);
            // 画像送信失敗時はテキストだけ送信（クラッシュ防止）
            await sendLongMessage(channel as TextChannel, text ?? '');
          }
        } else {
          await sendLongMessage(channel as TextChannel, text ?? '');
        }
      }
    });
    this.eventBus.subscribe('discord:scheduled_post', async (event) => {
      if (this.status !== 'running') return;
      const { text, command, imageBuffer } = event.data as DiscordScheduledPostInput;
      if (
        command === 'forecast' ||
        command === 'fortune' ||
        command === 'about_today' ||
        command === 'news_today'
      ) {
        const message = text ?? '';

        const sendScheduledPost = async (channel: TextChannel) => {
          if (imageBuffer) {
            try {
              const attachment = new AttachmentBuilder(imageBuffer, { name: `${command}.jpg` });
              const chunks = splitDiscordMessage(message);
              await channel.send({ content: chunks[0], files: [attachment] });
              for (let i = 1; i < chunks.length; i++) {
                await channel.send(chunks[i]);
              }
            } catch (imgErr) {
              logger.error('[Discord] 定期投稿の画像送信エラー:', imgErr);
              await sendLongMessage(channel, message);
            }
          } else {
            await sendLongMessage(channel, message);
          }
        };

        if (this.isDev) {
          const xChannelId = this.testXChannelId ?? '';
          const channel = this.client.channels.cache.get(xChannelId);
          if (channel?.isTextBased() && 'send' in channel) {
            await sendScheduledPost(channel as TextChannel);
          }
        } else {
          if (event.memoryZone === 'discord:colab_server') {
            const colabChannel = this.client.channels.cache.get(
              this.colabChannelId ?? ''
            );
            if (colabChannel?.isTextBased() && 'send' in colabChannel) {
              await sendScheduledPost(colabChannel as TextChannel);
            }
          } else if (event.memoryZone === 'discord:douki_server') {
            const doukiChannel = this.client.channels.cache.get(
              this.doukiChannelId ?? ''
            );
            if (doukiChannel?.isTextBased() && 'send' in doukiChannel) {
              await sendScheduledPost(doukiChannel as TextChannel);
            }
          } else if (event.memoryZone === 'discord:toyama_server') {
            const toyamaChannel = this.client.channels.cache.get(
              this.toyamaChannelId ?? ''
            );
            if (toyamaChannel?.isTextBased() && 'send' in toyamaChannel) {
              await sendScheduledPost(toyamaChannel as TextChannel);
            }
          } else if (event.memoryZone === 'discord:test_server') {
            const testChannelId = this.testXChannelId ?? '';
            const channel = this.client.channels.cache.get(testChannelId);
            if (channel?.isTextBased() && 'send' in channel) {
              await sendScheduledPost(channel as TextChannel);
            }
          } else {
            const xChannelId = this.aiminelabXChannelId ?? '';
            const channel = this.client.channels.cache.get(xChannelId);
            if (channel?.isTextBased() && 'send' in channel) {
              await sendScheduledPost(channel as TextChannel);
            }
          }
        }
        return;
      }
    });
    this.eventBus.subscribe('discord:get_server_emoji', async (event) => {
      if (this.status !== 'running') return;
      const data = event.data as DiscordGetServerEmojiInput;
      const { guildId } = data;
      const guild = this.client.guilds.cache.get(guildId);
      const memoryZone = await getDiscordMemoryZone(guildId);
      if (guild) {
        const emojis = guild.emojis.cache.map((emoji) => emoji.toString());
        this.eventBus.publish({
          type: 'tool:get_server_emoji',
          memoryZone: memoryZone,
          data: {
            emojis: emojis,
          } as DiscordGetServerEmojiOutput,
        });
      }
    });
    this.eventBus.subscribe('discord:send_server_emoji', async (event) => {
      if (this.status !== 'running') return;
      try {
        const data = event.data as DiscordSendServerEmojiInput;
        const { guildId, channelId, messageId, emojiId } = data;
        const guild = this.client.guilds.cache.get(guildId);
        const channel = this.client.channels.cache.get(channelId);
        if (!channel?.isTextBased() || !('messages' in channel)) return;
        const message = await channel.messages.fetch(messageId);
        if (message) {
          // サーバーカスタム絵文字を探す
          const serverEmoji = guild?.emojis.cache.get(emojiId);
          if (serverEmoji) {
            await message.react(serverEmoji);
          } else {
            // Unicode 絵文字としてそのまま使う（例: "😂", "👍"）
            await message.react(emojiId);
          }
        }
        this.eventBus.publish({
          type: 'tool:send_server_emoji',
          memoryZone: 'null',
          data: {
            isSuccess: true,
            errorMessage: '',
          } as DiscordSendServerEmojiOutput,
        });
      } catch (error) {
        logger.error('Error sending server emoji:', error);
        this.eventBus.publish({
          type: 'tool:send_server_emoji',
          memoryZone: 'null',
          data: {
            isSuccess: false,
            errorMessage:
              error instanceof Error ? error.message : 'Unknown error',
          } as DiscordSendServerEmojiOutput,
        });
      }
    });
    this.eventBus.subscribe('discord:planning', async (event) => {
      if (this.status !== 'running') return;
      let { planning, channelId, taskId } = event.data as DiscordPlanningInput;
      const channel = this.client.channels.cache.get(channelId);
      logger.info(`discord:planning ${taskId}`);

      if (channel?.isTextBased() && 'send' in channel) {
        const messages = await channel.messages.fetch({ limit: 10 });
        const existingMessage = messages.find(
          (msg) =>
            msg.author.id === this.client.user?.id &&
            msg.content.includes(`TaskID: ${taskId}`)
        );

        // ステータスに応じた絵文字を選択
        const getStatusEmoji = (status: string) => {
          switch (status) {
            case 'completed':
              return '🟢'; // 完了：緑
            case 'in_progress':
              return '🔵'; // 進行中：青
            case 'pending':
              return '🟡'; // 保留：黄色
            case 'error':
              return '🔴'; // エラー：赤
            default:
              return '⚪'; // その他：白
          }
        };

        const legend = `🟢:完了, 🔵:進行中, 🟡:保留, 🔴:エラー, ⚪:その他`;

        // タスク状態をMarkdown形式に整形
        let formattedContent = '';

        if (planning.status === 'completed') {
          if (existingMessage) {
            await existingMessage.delete();
          }
        } else {
          formattedContent = `TaskID: ${taskId}\n\n${getStatusEmoji(
            planning.status
          )} ${planning.goal}\n${planning.strategy}\n`;

          // hierarchicalSubTasks（新フォーマット）がある場合は追加
          if (planning.hierarchicalSubTasks && planning.hierarchicalSubTasks.length > 0) {
            planning.hierarchicalSubTasks.forEach((subTask) => {
              const depth = subTask.depth ?? 0;
              const indent = '  '.repeat(depth + 1);
              formattedContent += `${indent}${getStatusEmoji(subTask.status)} ${subTask.goal}\n`;
              if (subTask.result) {
                formattedContent += `${indent}  → ${subTask.result.substring(0, 100)}\n`;
              }
              if (subTask.failureReason) {
                formattedContent += `${indent}  ✗ ${subTask.failureReason.substring(0, 100)}\n`;
              }
            });
          }

          // subTasks（旧フォーマット互換）がある場合は追加
          if (planning.subTasks && planning.subTasks.length > 0) {
            planning.subTasks.forEach((subTask) => {
              formattedContent += `  ${getStatusEmoji(subTask.subTaskStatus)} ${subTask.subTaskGoal
                }\n`;
              formattedContent += `  ${subTask.subTaskStrategy}\n`;
            });
          }

          // 既存メッセージがあれば更新、なければ新規送信
          if (existingMessage) {
            await existingMessage.edit(
              `\`\`\`\n${formattedContent}\n\n${legend}\n\`\`\``
            );
          } else {
            await channel.send(
              `\`\`\`\n${formattedContent}\n\n${legend}\n\`\`\``
            );
          }
        }
      }
    });
    // --- Voice queue events (streaming pipeline) ---
    this.eventBus.subscribe('discord:voice_queue_start', async (event) => {
      if (this.status !== 'running') return;
      const { guildId, channelId } = event.data as DiscordVoiceQueueStartInput;
      this.voiceQueues.set(guildId, {
        buffers: [],
        done: false,
        notify: null,
        channelId,
        text: '',
      });
      this.consumeVoiceQueue(guildId);
    });

    this.eventBus.subscribe('discord:voice_enqueue', async (event) => {
      if (this.status !== 'running') return;
      const { guildId, audioBuffer } = event.data as DiscordVoiceEnqueueInput;
      const queue = this.voiceQueues.get(guildId);
      if (!queue) return;
      queue.buffers.push(audioBuffer);
      if (queue.notify) {
        queue.notify();
        queue.notify = null;
      }
    });

    this.eventBus.subscribe('discord:voice_queue_end', async (event) => {
      if (this.status !== 'running') return;
      const { guildId, channelId, text } = event.data as DiscordVoiceQueueEndInput;
      const queue = this.voiceQueues.get(guildId);
      if (!queue) return;
      queue.done = true;
      queue.text = text;
      queue.channelId = channelId;
      if (queue.notify) {
        queue.notify();
        queue.notify = null;
      }
    });

    this.eventBus.subscribe('discord:voice_status', async (event) => {
      if (this.status !== 'running') return;
      const { guildId, status, detail } = event.data as DiscordVoiceStatusInput;
      await this.updateVoiceStatusDisplay(guildId, status, detail);
    });

    // --- Legacy voice events (fallback) ---
    this.eventBus.subscribe('discord:play_voice_filler', async (event) => {
      if (this.status !== 'running') return;
      const { guildId, audioBuffers } = event.data as DiscordVoiceFillerInput;
      try {
        for (const buf of audioBuffers) {
          await this.playAudioInVoiceChannel(guildId, buf);
        }
      } catch (error) {
        logger.error('[Discord Voice] Filler playback error:', error);
      }
    });

    this.eventBus.subscribe('discord:post_voice_response', async (event) => {
      if (this.status !== 'running') return;
      const { channelId, voiceChannelId, guildId, text, audioBuffer, audioBuffers } =
        event.data as DiscordVoiceResponseInput;

      try {
        const textChannel = this.client.channels.cache.get(channelId);
        if (textChannel?.isTextBased() && 'send' in textChannel) {
          await sendLongMessage(textChannel as TextChannel, `🔊 シャノン: ${text}`);
        }

        if (audioBuffers && audioBuffers.length > 0) {
          for (const buf of audioBuffers) {
            await this.playAudioInVoiceChannel(guildId, buf);
          }
        } else {
          await this.playAudioInVoiceChannel(guildId, audioBuffer);
        }
      } catch (error) {
        logger.error('[Discord Voice] Error playing voice response:', error);
      }
    });

    this.eventBus.subscribe('youtube:subscriber_update', async (event) => {
      if (this.status !== 'running') return;
      const data = event.data as YoutubeSubscriberUpdateOutput;
      const { subscriberCount } = data;
      const guildId = config.discord.guilds.aimine.guildId;
      const guild = this.client.guilds.cache.get(guildId);
      if (guild) {
        const channel = guild.channels.cache.get(
          this.aiminelabAnnounceChannelId ?? ''
        );
        if (channel?.isTextBased() && 'send' in channel) {
          channel.send(`現在のチャンネル登録者数は${subscriberCount}人です。`);
        }
      }
    });
  }

  // ========== Voice Channel Methods ==========

  private async handleVoiceJoin(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      await interaction.reply({ content: 'ボイスチャンネルに参加してから実行してください。', ephemeral: true });
      return;
    }

    if (this.voiceConnections.has(interaction.guildId!)) {
      await interaction.reply({ content: '既にボイスチャンネルに参加しています。', ephemeral: true });
      return;
    }

    await interaction.deferReply();
    const guildId = interaction.guildId!;

    try {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: false,
      });

      const player = createAudioPlayer();
      connection.subscribe(player);

      this.voiceConnections.set(guildId, connection);
      this.audioPlayers.set(guildId, player);
      this.activeVoiceUsers.set(guildId, null);
      this.voiceTextChannelIds.set(guildId, interaction.channelId);

      connection.on(VoiceConnectionStatus.Ready, () => {
        logger.success(`[Discord Voice] Connected to ${voiceChannel.name}`);
        this.setupVoiceReceiver(connection, guildId, interaction.channelId);
      });

      connection.on(VoiceConnectionStatus.Disconnected, () => {
        logger.info('[Discord Voice] Disconnected', 'yellow');
        this.cleanupVoiceConnection(guildId);
      });

      connection.on(VoiceConnectionStatus.Destroyed, () => {
        logger.info('[Discord Voice] Connection destroyed', 'yellow');
        this.cleanupVoiceConnection(guildId);
      });

      const row = this.buildVoiceButtonRow({ isActive: false });

      const reply = await interaction.editReply({
        content: `🎙️ **${voiceChannel.name}** に参加しました！\n下のボタンを押すと通話が始まり、もう一度押すと終了します。`,
        components: [row],
      });
      this.voicePttMessages.set(guildId, { channelId: interaction.channelId, messageId: reply.id });
    } catch (error) {
      logger.error('[Discord Voice] Failed to join:', error);
      await interaction.editReply('ボイスチャンネルへの参加に失敗しました。');
    }
  }

  private async handleVoiceLeave(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    const connection = this.voiceConnections.get(guildId) || getVoiceConnection(guildId);

    if (!connection) {
      await interaction.reply({ content: 'ボイスチャンネルに参加していません。', ephemeral: true });
      return;
    }

    connection.destroy();
    this.cleanupVoiceConnection(guildId);
    await interaction.reply('👋 ボイスチャンネルから退出しました。');
  }

  private async handleVoicePttButton(interaction: ButtonInteraction) {
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;
    const activeUser = this.activeVoiceUsers.get(guildId);

    if (!this.voiceConnections.has(guildId)) {
      await interaction.reply({ content: 'シャノンはボイスチャンネルに参加していません。', ephemeral: true });
      return;
    }

    if (activeUser && activeUser !== userId) {
      const activeUserObj = this.client.users.cache.get(activeUser);
      const activeName = activeUserObj ? this.getUserNickname(activeUserObj, guildId) : 'Unknown';
      await interaction.reply({ content: `現在 **${activeName}** が通話中です。終了するまでお待ちください。`, ephemeral: true });
      return;
    }

    if (activeUser === userId) {
      this.activeVoiceUsers.set(guildId, null);
      logger.info(`[Discord Voice] PTT OFF: ${interaction.user.username}`, 'yellow');

      const row = this.buildVoiceButtonRow({ isActive: false });

      await interaction.update({
        content: `🎙️ ボイスチャンネルに参加中\n下のボタンを押すと通話が始まり、もう一度押すと終了します。`,
        components: [row],
      });
    } else {
      this.activeVoiceUsers.set(guildId, userId);
      const nickname = this.getUserNickname(interaction.user, guildId);
      logger.info(`[Discord Voice] PTT ON: ${interaction.user.username}`, 'cyan');

      const row = this.buildVoiceButtonRow({ isActive: true, nickname });

      await interaction.update({
        content: `🎙️ **${nickname}** が通話中です。シャノンが音声を聞いています。`,
        components: [row],
      });
    }
  }

  private async handleVoiceGenerateResponse(interaction: ButtonInteraction) {
    const guildId = interaction.guildId!;
    const channelId = interaction.channelId;

    if (!this.voiceConnections.has(guildId)) {
      await interaction.reply({ content: 'シャノンはボイスチャンネルに参加していません。', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const channel = this.client.channels.cache.get(channelId);
      if (!channel?.isTextBased() || !('messages' in channel)) {
        await interaction.editReply('テキストチャンネルが見つかりません。');
        return;
      }

      const rawMessages = await (channel as TextChannel).messages.fetch({ limit: 15 });
      const sorted = rawMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

      let lastUserText: string | null = null;
      let lastUserName: string | null = null;
      let lastUserId: string | null = null;

      for (const msg of sorted.reverse().values()) {
        if (msg.author.bot) continue;

        lastUserText = msg.content;
        lastUserName = this.getUserNickname(msg.author, guildId);
        lastUserId = msg.author.id;
        break;
      }

      if (!lastUserText) {
        const shannonMessages = [...sorted.values()].reverse();
        for (const msg of shannonMessages) {
          if (!msg.author.bot) continue;
          const match = msg.content.match(/^🎤\s*(.+?):\s*(.+)$/);
          if (match) {
            lastUserName = match[1];
            lastUserText = match[2];
            lastUserId = interaction.user.id;
            break;
          }
        }
      }

      if (!lastUserText) {
        await interaction.editReply('直近のユーザーメッセージが見つかりませんでした。');
        return;
      }

      const guild = this.client.guilds.cache.get(guildId);
      const guildName = guild?.name ?? '';
      const channelName = 'name' in channel ? (channel as TextChannel).name : '';
      const voiceConnection = this.voiceConnections.get(guildId);
      const voiceChannelId = voiceConnection?.joinConfig.channelId ?? '';
      const memoryZone = await getDiscordMemoryZone(guildId);
      const recentMessages = await this.getRecentMessages(channelId, 10);

      this.eventBus.publish({
        type: 'llm:get_discord_message',
        memoryZone,
        data: {
          type: 'voice',
          text: lastUserText,
          audioBuffer: Buffer.alloc(0),
          guildId,
          guildName,
          channelId,
          channelName,
          voiceChannelId,
          userId: lastUserId ?? interaction.user.id,
          userName: lastUserName ?? this.getUserNickname(interaction.user, guildId),
          recentMessages,
        } as unknown as DiscordClientInput,
      });

      logger.info(`[Discord Voice] Generate response from text: "${lastUserText}" by ${lastUserName}`, 'cyan');
      await interaction.editReply(`💬 「${lastUserText}」に対する音声回答を生成中…`);
    } catch (error) {
      logger.error('[Discord Voice] Generate response failed:', error);
      await interaction.editReply('音声回答の生成に失敗しました。');
    }
  }

  private buildVoiceButtonRow(options: { isActive: boolean; nickname?: string | null }): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('voice_ptt')
        .setLabel(options.isActive ? `🔴 ${options.nickname ?? 'ユーザー'} が通話中... (押して終了)` : '🎤 話す')
        .setStyle(options.isActive ? ButtonStyle.Danger : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('voice_generate_response')
        .setLabel('💬 音声回答を生成')
        .setStyle(ButtonStyle.Primary),
    );
  }

  private cleanupVoiceConnection(guildId: string) {
    this.voiceConnections.delete(guildId);
    this.audioPlayers.delete(guildId);
    this.activeVoiceUsers.delete(guildId);
    this.voiceTextChannelIds.delete(guildId);
    for (const [key, timer] of this.userSpeakingTimers) {
      if (key.startsWith(guildId)) {
        clearTimeout(timer);
        this.userSpeakingTimers.delete(key);
      }
    }
    for (const key of this.userAudioBuffers.keys()) {
      if (key.startsWith(guildId)) {
        this.userAudioBuffers.delete(key);
      }
    }
    this.voiceProcessingLock.delete(guildId);
    this.voicePttMessages.delete(guildId);
  }

  private static readonly VOICE_STATUS_LABELS: Record<string, string> = {
    listening: '👂 聞き取り中…',
    stt: '📝 音声認識中…',
    filler_select: '🎯 フィラー選択中…',
    llm: '🧠 回答生成中…',
    tts: '🔊 音声生成中…',
    speaking: '🗣️ 再生中…',
    idle: '',
  };

  private async updateVoiceStatusDisplay(guildId: string, status: string, detail?: string): Promise<void> {
    const pttMsg = this.voicePttMessages.get(guildId);
    if (!pttMsg) return;

    try {
      const channel = this.client.channels.cache.get(pttMsg.channelId);
      if (!channel?.isTextBased() || !('messages' in channel)) return;

      const message = await (channel as TextChannel).messages.fetch(pttMsg.messageId).catch(() => null);
      if (!message) return;

      const activeUserId = this.activeVoiceUsers.get(guildId);
      const activeUser = activeUserId ? this.client.users.cache.get(activeUserId) : null;
      const nickname = activeUser ? this.getUserNickname(activeUser, guildId) : null;

      const statusLabel = DiscordBot.VOICE_STATUS_LABELS[status] || '';
      const statusLine = statusLabel
        ? `\n${statusLabel}${detail ? ` ${detail}` : ''}`
        : '';

      const isActive = !!activeUserId;
      const row = this.buildVoiceButtonRow({ isActive, nickname });

      const baseContent = isActive
        ? `🎙️ **${nickname}** が通話中です。シャノンが音声を聞いています。`
        : '🎙️ ボイスチャンネルに参加中\n下のボタンを押すと通話が始まり、もう一度押すと終了します。';

      await message.edit({
        content: `${baseContent}${statusLine}`,
        components: [row],
      });
    } catch {
      // best-effort UI update
    }
  }

  private setupVoiceReceiver(connection: VoiceConnection, guildId: string, textChannelId: string) {
    const receiver = connection.receiver;

    receiver.speaking.on('start', (userId) => {
      const activeUser = this.activeVoiceUsers.get(guildId);
      if (!activeUser || activeUser !== userId) return;
      if (this.voiceProcessingLock.get(guildId)) return;

      const bufferKey = `${guildId}:${userId}`;

      const existingTimer = this.userSpeakingTimers.get(bufferKey);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.userSpeakingTimers.delete(bufferKey);
      }

      if (!this.userAudioBuffers.has(bufferKey)) {
        this.userAudioBuffers.set(bufferKey, []);
      }

      const opusStream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
      });

      opusStream.on('error', (err) => {
        logger.warn(`[Discord Voice] AudioReceiveStream error (${userId}): ${err.message}`);
      });

      opusStream.on('data', (chunk: Buffer) => {
        if (this.activeVoiceUsers.get(guildId) !== userId) return;
        const buffers = this.userAudioBuffers.get(bufferKey);
        if (buffers) {
          buffers.push(chunk);
        }
      });

      opusStream.on('end', () => {
        const timer = setTimeout(async () => {
          this.userSpeakingTimers.delete(bufferKey);
          const audioBuffers = this.userAudioBuffers.get(bufferKey);
          this.userAudioBuffers.delete(bufferKey);

          if (!audioBuffers || audioBuffers.length === 0) return;
          if (this.activeVoiceUsers.get(guildId) !== userId) return;

          try {
            const pcmBuffer = this.decodeOpusBuffers(audioBuffers);
            if (pcmBuffer.length < 48000) return; // 0.5秒未満は無視（ノイズ防止）

            await this.processVoiceInput(pcmBuffer, userId, guildId, textChannelId);
          } catch (err) {
            logger.error('[Discord Voice] Error processing audio:', err);
          }
        }, 300);
        this.userSpeakingTimers.set(bufferKey, timer);
      });
    });
  }

  private decodeOpusBuffers(opusBuffers: Buffer[]): Buffer {
    const encoder = new OpusEncoder(48000, 2);
    const pcmChunks: Buffer[] = [];

    for (const opusPacket of opusBuffers) {
      try {
        const pcm = encoder.decode(opusPacket);
        pcmChunks.push(pcm);
      } catch {
        // skip corrupted packets
      }
    }

    return Buffer.concat(pcmChunks);
  }

  private createWavBuffer(pcmBuffer: Buffer, sampleRate: number = 48000, channels: number = 2, bitsPerSample: number = 16): Buffer {
    const dataSize = pcmBuffer.length;
    const header = Buffer.alloc(44);

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
    header.writeUInt16LE(channels * (bitsPerSample / 8), 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcmBuffer]);
  }

  private async processVoiceInput(pcmBuffer: Buffer, userId: string, guildId: string, textChannelId: string) {
    if (this.voiceProcessingLock.get(guildId)) return;
    this.voiceProcessingLock.set(guildId, true);

    try {
      const wavBuffer = this.createWavBuffer(pcmBuffer);

      const user = this.client.users.cache.get(userId);
      const nickname = user ? this.getUserNickname(user, guildId) : 'Unknown';
      const memoryZone = await getDiscordMemoryZone(guildId);

      const guild = this.client.guilds.cache.get(guildId);
      const guildName = guild?.name ?? '';
      const textChannel = this.client.channels.cache.get(textChannelId);
      const channelName = textChannel && 'name' in textChannel ? textChannel.name : '';

      const voiceConnection = this.voiceConnections.get(guildId);
      const voiceChannelId = voiceConnection?.joinConfig.channelId ?? '';

      const recentMessages = await this.getRecentMessages(textChannelId, 10);

      this.eventBus.publish({
        type: 'llm:get_discord_message',
        memoryZone: memoryZone,
        data: {
          type: 'voice',
          text: '',
          audioBuffer: wavBuffer,
          guildId,
          guildName,
          channelId: textChannelId,
          channelName,
          voiceChannelId,
          userId,
          userName: nickname,
          recentMessages,
        } as unknown as DiscordClientInput,
      });
    } finally {
      this.voiceProcessingLock.set(guildId, false);
    }
  }

  private async playAudioInVoiceChannel(guildId: string, wavBuffer: Buffer): Promise<void> {
    const player = this.audioPlayers.get(guildId);
    if (!player) {
      logger.warn('[Discord Voice] No audio player for guild');
      return;
    }

    return new Promise<void>((resolve, reject) => {
      try {
        const stream = Readable.from(wavBuffer);
        const resource = createAudioResource(stream);

        player.play(resource);

        player.once(AudioPlayerStatus.Idle, () => resolve());
        player.once('error', (err) => {
          logger.error('[Discord Voice] Playback error:', err);
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  private async consumeVoiceQueue(guildId: string): Promise<void> {
    const queue = this.voiceQueues.get(guildId);
    if (!queue) return;

    try {
      let isFirstPlay = true;
      while (true) {
        if (queue.buffers.length > 0) {
          if (isFirstPlay) {
            await this.updateVoiceStatusDisplay(guildId, 'speaking');
            isFirstPlay = false;
          }
          const buf = queue.buffers.shift()!;
          await this.playAudioInVoiceChannel(guildId, buf);
          continue;
        }

        if (queue.done) break;

        await new Promise<void>((resolve) => {
          queue.notify = resolve;
        });
      }

      if (queue.text) {
        const textChannel = this.client.channels.cache.get(queue.channelId);
        if (textChannel?.isTextBased() && 'send' in textChannel) {
          await sendLongMessage(textChannel as TextChannel, `🔊 シャノン: ${queue.text}`);
        }
      }
    } catch (error) {
      logger.error('[Discord Voice] Queue playback error:', error);
    } finally {
      this.voiceQueues.delete(guildId);
      await this.updateVoiceStatusDisplay(guildId, 'idle');
    }
  }

  /**
   * 指定したチャンネルの直近のメッセージを取得
   * @param channelId 対象のチャンネルID
   * @param limit 取得するメッセージ数（デフォルト10件）
   * @returns 会話ログの配列
   */
  public async getRecentMessages(
    channelId: string,
    limit: number = 10
  ): Promise<BaseMessage[]> {
    try {
      let channel = this.client.channels.cache.get(channelId);
      // キャッシュにない場合はfetchを試みる（スレッドチャンネル等）
      if (!channel) {
        try { channel = await this.client.channels.fetch(channelId) ?? undefined; } catch { /* ignore */ }
      }
      if (!channel?.isTextBased() || !('messages' in channel)) {
        throw new Error('Invalid channel or not a text channel');
      }

      const messages = await channel.messages.fetch({ limit });
      const conversationLog = messages
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map((msg) => {
          const nickname = this.getUserNickname(msg.author, msg.guildId ?? '');
          const timestamp = new Date(msg.createdTimestamp).toLocaleString(
            'ja-JP',
            { timeZone: 'Asia/Tokyo' }
          );

          // 画像URLを取得
          const imageUrls = msg.attachments
            .filter((attachment) =>
              attachment.contentType?.startsWith('image/')
            )
            .map((attachment) => attachment.url);

          // テキストと画像URLを結合
          const contentWithImages =
            imageUrls.length > 0
              ? `${msg.content}\n画像: ${imageUrls.join('\n')}`
              : msg.content;

          if (msg.author.bot) {
            const voiceUserMatch = contentWithImages.match(/^🎤\s*(.+?):\s*/);
            if (voiceUserMatch) {
              const voiceUserName = voiceUserMatch[1];
              const voiceText = contentWithImages.replace(/^🎤\s*.+?:\s*/, '');
              return new HumanMessage(
                timestamp + ' ' + voiceUserName + ': ' + voiceText
              );
            }
            const shannonVoiceMatch = contentWithImages.match(/^🔊\s*シャノン:\s*/);
            if (shannonVoiceMatch) {
              const shannonText = contentWithImages.replace(/^🔊\s*シャノン:\s*/, '');
              return new AIMessage(
                timestamp + ' シャノン: ' + shannonText
              );
            }
            return new AIMessage(
              timestamp + ' ' + nickname + 'AI: ' + contentWithImages
            );
          } else {
            return new HumanMessage(
              timestamp + ' ' + nickname + ': ' + contentWithImages
            );
          }
        });

      return conversationLog;
    } catch (error) {
      logger.error('Error fetching recent messages:', error);
      this.eventBus.log(
        'discord:aiminelab_server',
        'red',
        `Error fetching recent messages: ${error}`
      );
      return [];
    }
  }
}

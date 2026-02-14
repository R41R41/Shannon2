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
  MinebotInput,
  MinecraftServerName,
  ServiceInput,
  YoutubeSubscriberUpdateOutput,
} from '@shannon/common';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  ComponentType,
  EmbedBuilder,
  GatewayIntentBits,
  SlashCommandBuilder,
  TextChannel,
  User,
} from 'discord.js';
import fs from 'fs';
import * as Jimp from 'jimp';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../../config/env.js';
import { getDiscordMemoryZone } from '../../utils/discord.js';
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
  public static getInstance(isDev: boolean = false) {
    if (!DiscordBot.instance) {
      DiscordBot.instance = new DiscordBot('discord', isDev);
    }
    DiscordBot.instance.isDev = isDev;
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
    });
    this.eventBus = eventBus;

    this.client.once('ready', () => {
      this.setupSlashCommands();
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
      console.log('\x1b[34mDiscord bot started\x1b[0m');
      this.eventBus.log(
        'discord:aiminelab_server',
        'blue',
        'Discord bot started'
      );
    } catch (error) {
      console.error('\x1b[31mDiscord bot failed to start\x1b[0m');
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
          console.log(`\x1b[32mSlash commands registered to guild: ${guild.name}\x1b[0m`);
        } else {
          console.log(`\x1b[33mGuild ${targetGuildId} not found, falling back to global\x1b[0m`);
          if (this.client.application) {
            await this.client.application.commands.set(commandsJson);
            console.log('\x1b[32mSlash commands registered globally\x1b[0m');
          }
        }
      } else if (this.client.application) {
        await this.client.application.commands.set(commandsJson);
        console.log('\x1b[32mSlash commands registered globally\x1b[0m');
      }

      this.client.on('interactionCreate', async (interaction) => {
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
                console.error('Status error:', error);
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
                console.error('Start error:', error);
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
                console.error('Stop error:', error);
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
                console.error('Minebot login error:', error);
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
                console.error('Minebot logout error:', error);
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
        }
      });
      console.log('\x1b[32mSlash command setup completed\x1b[0m');
    } catch (error) {
      console.error(`\x1b[31mSlash command setup error: ${error}\x1b[0m`);
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
    console.log("ファイル削除");
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
    this.client.on('messageCreate', async (message) => {
      if (this.status !== 'running') return;
      const isDevGuild = message.guildId === config.discord.guilds.test.guildId;
      if (this.isDev !== isDevGuild) return;
      console.log(message.content);

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
      if (mentions.length > 0 && !isMentioned) return;

      if (message.channelId === this.aiminelabUpdateChannelId) return;

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

      // テキストと画像URLを結合
      const contentWithImages =
        imageUrls.length > 0
          ? `${messageContent}\n画像: ${imageUrls.join('\n')}`
          : messageContent;

      if (
        guildId === this.toyamaGuildId &&
        message.channelId !== this.toyamaChannelId
      )
        return;
      if (
        guildId === this.doukiGuildId &&
        message.channelId !== this.doukiChannelId
      )
        return;
      if (
        guildId === this.colabGuildId &&
        message.channelId !== this.colabChannelId
      )
        return;
      this.eventBus.log(
        memoryZone,
        'white',
        `${guildName} ${channelName}\n${nickname}: ${contentWithImages}`,
        true
      );
      console.log('\x1b[34m' + guildName + ' ' + channelName + '\x1b[0m');
      console.log('\x1b[34m' + nickname + ': ' + contentWithImages + '\x1b[0m');
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
        console.log('\x1b[34m' + guildName + ' ' + channelName + '\x1b[0m');
        console.log('\x1b[34m' + 'shannon: ' + text + '\x1b[0m');
        if (imageUrl) {
          const embed = {
            image: {
              url: imageUrl,
            },
          };
          channel.send({ content: text ?? '', embeds: [embed] });
        } else {
          channel.send(text ?? '');
        }
      }
    });
    this.eventBus.subscribe('discord:scheduled_post', async (event) => {
      if (this.status !== 'running') return;
      const { text, command } = event.data as DiscordScheduledPostInput;
      if (
        command === 'forecast' ||
        command === 'fortune' ||
        command === 'about_today' ||
        command === 'news_today'
      ) {
        if (this.isDev) {
          const xChannelId = this.testXChannelId ?? '';
          const channel = this.client.channels.cache.get(xChannelId);
          if (channel?.isTextBased() && 'send' in channel) {
            channel.send(text ?? '');
          }
        } else {
          if (event.memoryZone === 'discord:colab_server') {
            const colabChannel = this.client.channels.cache.get(
              this.colabChannelId ?? ''
            );
            if (colabChannel?.isTextBased() && 'send' in colabChannel) {
              colabChannel.send(text ?? '');
            }
          } else if (event.memoryZone === 'discord:douki_server') {
            const doukiChannel = this.client.channels.cache.get(
              this.doukiChannelId ?? ''
            );
            if (doukiChannel?.isTextBased() && 'send' in doukiChannel) {
              doukiChannel.send(text ?? '');
            }
          } else if (event.memoryZone === 'discord:toyama_server') {
            const toyamaChannel = this.client.channels.cache.get(
              this.toyamaChannelId ?? ''
            );
            if (toyamaChannel?.isTextBased() && 'send' in toyamaChannel) {
              toyamaChannel.send(text ?? '');
            }
          } else if (event.memoryZone === 'discord:test_server') {
            const testChannelId = this.testXChannelId ?? '';
            const channel = this.client.channels.cache.get(testChannelId);
            if (channel?.isTextBased() && 'send' in channel) {
              channel.send(text ?? '');
            }
          } else {
            const xChannelId = this.aiminelabXChannelId ?? '';
            const channel = this.client.channels.cache.get(xChannelId);
            if (channel?.isTextBased() && 'send' in channel) {
              channel.send(text ?? '');
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
        if (guild && message) {
          const emoji = guild.emojis.cache.get(emojiId);
          if (emoji) {
            await message.react(emoji);
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
        console.error('Error sending server emoji:', error);
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
      console.log('discord:planning', taskId);

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
      const channel = this.client.channels.cache.get(channelId);
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
      console.error('Error fetching recent messages:', error);
      this.eventBus.log(
        'discord:aiminelab_server',
        'red',
        `Error fetching recent messages: ${error}`
      );
      return [];
    }
  }
}

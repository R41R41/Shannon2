import {
  DiscordClientInput,
  DiscordClientOutput,
  MinecraftServerName,
  ServiceInput,
} from '@shannon/common';
import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  TextChannel,
  User,
} from 'discord.js';
import dotenv from 'dotenv';
import { getDiscordMemoryZone } from '../../utils/discord.js';
import { BaseClient } from '../common/BaseClient.js';
import { EventBus } from '../eventBus.js';
dotenv.config();

export class DiscordBot extends BaseClient {
  private client: Client;
  private toyamaGuildId: string | null = null;
  private toyamaChannelId: string | null = null;
  private aiminelabGuildId: string | null = null;
  private aiminelabXChannelId: string | null = null;
  private testGuildId: string | null = null;
  private testXChannelId: string | null = null;
  private static instance: DiscordBot;
  public isTest: boolean = false;

  public static getInstance(eventBus: EventBus, isTest: boolean = false) {
    if (!DiscordBot.instance) {
      DiscordBot.instance = new DiscordBot('discord', eventBus, isTest);
    }
    DiscordBot.instance.isTest = isTest;
    return DiscordBot.instance;
  }

  private constructor(
    serviceName: 'discord',
    eventBus: EventBus,
    isTest: boolean = false
  ) {
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
    this.toyamaGuildId = process.env.TOYAMA_GUILD_ID ?? '';
    this.toyamaChannelId = process.env.TOYAMA_CHANNEL_ID ?? '';
    this.aiminelabGuildId = process.env.AIMINE_GUILD_ID ?? '';
    this.aiminelabXChannelId = process.env.AIMINE_X_CHANNEL_ID ?? '';
    this.testGuildId = process.env.TEST_GUILD_ID ?? '';
    this.testXChannelId = process.env.TEST_X_CHANNEL_ID ?? '';
  }

  public initialize() {
    try {
      this.client.login(process.env.DISCORD_TOKEN);
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
      const commands = [
        new SlashCommandBuilder()
          .setName('minecraft_server_status')
          .setDescription('Minecraftサーバーの状態を取得する')
          .addStringOption((option) =>
            option
              .setName('server_name')
              .setDescription('サーバー名')
              .setRequired(true)
              .addChoices(
                { name: 'ワールド1', value: 'world1' },
                { name: 'ワールド2', value: 'world2' }
              )
          ),
      ];

      // コマンドをJSON形式に変換
      const commandsJson = commands.map((command) => command.toJSON());

      // コマンドを登録
      if (this.client.application) {
        await this.client.application.commands.set(commandsJson);
        console.log('\x1b[32mSlash commands registered successfully\x1b[0m');
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
              const data = {
                type: 'command',
                serverName: serverName,
                command: 'status',
              } as ServiceInput;
              try {
                this.eventBus.publish({
                  type: `minecraft:${serverName}:status`,
                  memoryZone: 'minecraft',
                  data: data,
                });
                await interaction.reply('ツイートを送信しました！');
              } catch (error) {
                await interaction.reply('ツイートの送信に失敗しました。');
                console.error('Tweet error:', error);
              }
            }
            break;
        }
      });
      console.log('\x1b[32mSlash command setup completed\x1b[0m');
    } catch (error) {
      console.error(`\x1b[31mSlash command setup error: ${error}\x1b[0m`);
    }
  }

  private getUserNickname(user: User) {
    if (user.displayName) {
      return user.displayName;
    }
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
      const isTestGuild = message.guildId === process.env.TEST_GUILD_ID;
      if (this.isTest !== isTestGuild) return;

      if (message.author.bot) return;
      const nickname = this.getUserNickname(message.author);
      const channelName = this.getChannelName(message.channelId);
      const guildName = this.getGuildName(message.channelId);
      const memoryZone = getDiscordMemoryZone(message.guildId ?? '');
      const messageId = message.id;
      const userId = message.author.id;
      const guildId = message.guildId;
      const recentMessages = await this.getRecentMessages(message.channelId);
      if (
        guildId === this.toyamaGuildId &&
        message.channelId !== this.toyamaChannelId
      )
        return;
      this.eventBus.log(
        memoryZone,
        'white',
        `${guildName} ${channelName}\n${nickname}: ${message.content}`,
        true
      );
      console.log('\x1b[34m' + guildName + ' ' + channelName + '\x1b[0m');
      console.log('\x1b[34m' + nickname + ': ' + message.content + '\x1b[0m');
      this.eventBus.publish({
        type: 'llm:get_discord_message',
        memoryZone: memoryZone,
        data: {
          text: message.content,
          type: 'text',
          guildName: memoryZone,
          channelId: message.channelId,
          guildId: guildId,
          channelName: channelName,
          userName: nickname,
          messageId: messageId,
          userId: userId,
          recentMessages: recentMessages,
        } as DiscordClientInput,
      });
    });

    // 音声メッセージの処理
    this.client.on('speech', (speech) => {
      if (this.status !== 'running') return;
      // テストモードの場合はテストサーバーのみ、それ以外の場合はテストサーバー以外を処理
      const channel = this.client.channels.cache.get(speech.channelId);
      if (!channel || !('guild' in channel)) return;

      const isTestGuild = channel.guild.id === process.env.TEST_GUILD_ID;
      if (this.isTest !== isTestGuild) return;

      const memoryZone = getDiscordMemoryZone(channel.guildId);

      const nickname = this.getUserNickname(speech.user);
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
    this.eventBus.subscribe('discord:post_message', (event) => {
      if (this.status !== 'running') return;
      if (event.type === 'discord:post_message') {
        let { text, type, channelId, guildId, audio, command, imageUrl } =
          event.data as DiscordClientOutput;
        if (
          command === 'forecast' ||
          command === 'fortune' ||
          command === 'about_today'
        ) {
          guildId = this.toyamaGuildId ?? '';
          if (this.isTest) {
            const xChannelId = this.testXChannelId ?? '';
            const channel = this.client.channels.cache.get(xChannelId);
            if (channel?.isTextBased() && 'send' in channel) {
              channel.send(text ?? '');
            }
          } else {
            const xChannelId = this.aiminelabXChannelId ?? '';
            const channel = this.client.channels.cache.get(xChannelId);
            if (channel?.isTextBased() && 'send' in channel) {
              channel.send(text ?? '');
            }
            const toyamaChannel = this.client.channels.cache.get(
              this.toyamaChannelId ?? ''
            );
            if (toyamaChannel?.isTextBased() && 'send' in toyamaChannel) {
              toyamaChannel.send(text ?? '');
            }
          }
          return;
        }

        const channel = this.client.channels.cache.get(channelId);
        const channelName = this.getChannelName(channelId);
        const guildName = this.getGuildName(channelId);
        const memoryZone = getDiscordMemoryZone(guildId);

        if (channel?.isTextBased() && 'send' in channel) {
          if (type === 'text') {
            this.eventBus.log(
              memoryZone,
              'white',
              `${guildName} ${channelName}\nShannon: ${text}`,
              true
            );
            console.log('\x1b[34m' + guildName + ' ' + channelName + '\x1b[0m');
            console.log('\x1b[34m' + 'shannon: ' + text + '\x1b[0m');
            channel.send(text ?? '');
          } else if (type === 'realtime_audio' && audio) {
          }
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
  ): Promise<
    {
      name: string;
      content: string;
      timestamp: string;
      imageUrl?: string[];
    }[]
  > {
    try {
      const channel = this.client.channels.cache.get(channelId);
      if (!channel?.isTextBased() || !('messages' in channel)) {
        throw new Error('Invalid channel or not a text channel');
      }

      const messages = await channel.messages.fetch({ limit });
      const conversationLog = messages
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map((msg) => {
          const nickname = this.getUserNickname(msg.author);
          const imageUrls = msg.attachments.map((attachment) => attachment.url);
          return {
            name: nickname,
            content: msg.content,
            timestamp: new Date(msg.createdTimestamp).toISOString(),
            ...(imageUrls.length > 0 && { imageUrl: imageUrls }),
          };
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

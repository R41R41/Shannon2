import {
  DiscordClientInput,
  MinecraftServerName,
  ServiceInput,
  DiscordScheduledPostInput,
  DiscordSendTextMessageInput,
  DiscordGetServerEmojiInput,
  DiscordGetServerEmojiOutput,
  DiscordSendServerEmojiInput,
  DiscordSendServerEmojiOutput,
  DiscordSendTextMessageOutput,
  DiscordPlanningInput,
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
import { getEventBus } from '../eventBus/index.js';
import { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
dotenv.config();

export class DiscordBot extends BaseClient {
  private client: Client;
  private toyamaGuildId: string | null = null;
  private toyamaChannelId: string | null = null;
  private aiminelabGuildId: string | null = null;
  private aiminelabXChannelId: string | null = null;
  private testGuildId: string | null = null;
  private testXChannelId: string | null = null;
  private doukiGuildId: string | null = null;
  private doukiChannelId: string | null = null;
  private static instance: DiscordBot;
  public isTest: boolean = false;
  public static getInstance(isTest: boolean = false) {
    if (!DiscordBot.instance) {
      DiscordBot.instance = new DiscordBot('discord', isTest);
    }
    DiscordBot.instance.isTest = isTest;
    return DiscordBot.instance;
  }

  private constructor(serviceName: 'discord', isTest: boolean = false) {
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
    this.toyamaGuildId = process.env.TOYAMA_GUILD_ID ?? '';
    this.doukiGuildId = process.env.DOUKI_GUILD_ID ?? '';
    this.toyamaChannelId = process.env.TOYAMA_CHANNEL_ID ?? '';
    this.doukiChannelId = process.env.DOUKI_CHANNEL_ID ?? '';
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
      const isTestGuild = message.guildId === process.env.TEST_GUILD_ID;
      if (this.isTest !== isTestGuild) return;
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

      const isTestGuild = channel.guild.id === process.env.TEST_GUILD_ID;
      if (this.isTest !== isTestGuild) return;

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
      let { text, channelId, guildId, taskId } =
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
        channel.send(text ?? '');
      }
    });
    this.eventBus.subscribe('discord:scheduled_post', async (event) => {
      if (this.status !== 'running') return;
      const { text, command } = event.data as DiscordScheduledPostInput;
      if (
        command === 'forecast' ||
        command === 'fortune' ||
        command === 'about_today'
      ) {
        if (this.isTest) {
          const xChannelId = this.testXChannelId ?? '';
          const channel = this.client.channels.cache.get(xChannelId);
          if (channel?.isTextBased() && 'send' in channel) {
            channel.send(text ?? '');
          }
        } else {
          if (event.memoryZone === 'discord:douki_server') {
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

          // サブタスクがある場合は追加
          if (planning.subTasks && planning.subTasks.length > 0) {
            planning.subTasks.forEach((subTask) => {
              formattedContent += `  ${getStatusEmoji(subTask.subTaskStatus)} ${
                subTask.subTaskGoal
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

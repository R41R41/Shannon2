import {
  Channel,
  Client,
  GatewayIntentBits,
  TextChannel,
  User,
} from 'discord.js';
import { EventBus, DiscordMessage } from '../eventBus.js';

export class DiscordBot {
  private client: Client;
  private eventBus: EventBus;
  private isTestMode: boolean;

  constructor(eventBus: EventBus, isTestMode: boolean = false) {
    this.isTestMode = isTestMode;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
      ],
    });
    this.eventBus = eventBus;
    this.setupEventHandlers();
  }

  public start() {
    try {
      this.client.login(process.env.DISCORD_TOKEN);
      console.log('\x1b[34mDiscord bot started\x1b[0m');
      this.eventBus.log('discord', 'blue', 'Discord bot started');
    } catch (error) {
      console.error('\x1b[31mDiscord bot failed to start\x1b[0m');
      this.eventBus.log(
        'discord',
        'red',
        'Discord bot failed to start' + error
      );
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
    // テキストメッセージの処理
    this.client.on('messageCreate', (message) => {
      // テストモードの場合はテストサーバーのみ、それ以外の場合はテストサーバー以外を処理
      const isTestGuild = message.guildId === process.env.TEST_GUILD_ID;
      if (this.isTestMode !== isTestGuild) return;

      if (message.author.bot) return;
      const nickname = this.getUserNickname(message.author);
      const channelName = this.getChannelName(message.channelId);
      const guildName = this.getGuildName(message.channelId);
      const messageId = message.id;
      const userId = message.author.id;
      this.eventBus.log(
        'discord',
        'blue',
        guildName +
          ' ' +
          channelName +
          '\n' +
          nickname +
          ': ' +
          message.content,
        true
      );
      console.log('\x1b[34m' + guildName + ' ' + channelName + '\x1b[0m');
      console.log('\x1b[34m' + nickname + ': ' + message.content + '\x1b[0m');
      this.eventBus.publish({
        type: 'discord:message',
        platform: 'discord',
        data: {
          content: message.content,
          type: 'text',
          guildName: guildName,
          channelId: message.channelId,
          channelName: channelName,
          userName: nickname,
          messageId: messageId,
          userId: userId,
        } as DiscordMessage,
      });
    });

    // 音声メッセージの処理
    this.client.on('speech', (speech) => {
      // テストモードの場合はテストサーバーのみ、それ以外の場合はテストサーバー以外を処理
      const channel = this.client.channels.cache.get(speech.channelId);
      if (!channel || !('guild' in channel)) return;

      const isTestGuild = channel.guild.id === process.env.TEST_GUILD_ID;
      if (this.isTestMode !== isTestGuild) return;

      const nickname = this.getUserNickname(speech.user);
      this.eventBus.publish({
        type: 'discord:message',
        platform: 'discord',
        data: {
          content: speech.content,
          type: 'voice',
          channelId: speech.channelId,
          userName: nickname,
        } as DiscordMessage,
      });
    });

    // LLMからの応答を処理
    this.eventBus.subscribe('llm:response', (event) => {
      if (event.platform === 'discord') {
        const { content, type, channelId, userName } =
          event.data as DiscordMessage;

        const channel = this.client.channels.cache.get(channelId);
        const channelName = this.getChannelName(channelId);
        const guildName = this.getGuildName(channelId);

        if (channel?.isTextBased() && 'send' in channel) {
          if (type === 'text') {
            this.eventBus.log(
              'discord',
              'green',
              guildName + ' ' + channelName + '\n' + 'Shannon: ' + content,
              true
            );
            console.log('\x1b[34m' + guildName + ' ' + channelName + '\x1b[0m');
            console.log('\x1b[34m' + userName + ': ' + content + '\x1b[0m');
            channel.send(content);
          } else if (type === 'voice') {
            this.synthesizeAndPlay(channel as TextChannel, content);
          }
        }
      }
    });

    // Twitterの投稿を処理
    this.eventBus.subscribe('twitter:post', (event) => {
      const announcementChannel = this.getAnnouncementChannel();
      if (announcementChannel) {
        announcementChannel.send(
          `新しいツイート: ${event.data.content}\nhttps://twitter.com/user/status/${event.data.tweetId}`
        );
      }
    });

    // YouTubeの統計を処理
    this.eventBus.subscribe('youtube:stats', (event) => {
      const statsChannel = this.getStatsChannel();
      if (statsChannel) {
        statsChannel.send(
          `📊 YouTube統計\n登録者数: ${event.data.subscribers}\n総視聴回数: ${event.data.views}`
        );
      }
    });
  }

  private getAnnouncementChannel() {
    return this.client.channels.cache.get(
      process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID as string
    ) as TextChannel;
  }

  private getStatsChannel() {
    return this.client.channels.cache.get(
      process.env.DISCORD_STATS_CHANNEL_ID as string
    ) as TextChannel;
  }

  private async synthesizeAndPlay(channel: TextChannel, text: string) {
    // 音声合成と再生の実装
    // 例: Google Cloud Text-to-Speech APIなどを使用
  }
}

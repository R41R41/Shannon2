import { Client, GatewayIntentBits, TextChannel } from 'discord.js';
import { EventBus } from '../llm/eventBus.js';

export class DiscordBot {
  private client: Client;
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
    });
    this.eventBus = eventBus;
    this.setupEventHandlers();
  }

  public start() {
    this.client.login(process.env.DISCORD_TOKEN);
  }

  private setupEventHandlers() {
    // テキストメッセージの処理
    this.client.on('messageCreate', message => {
      if (message.author.bot) return;
      
      this.eventBus.publish({
        type: 'discord:message',
        platform: 'discord',
        data: {
          content: message.content,
          type: 'text',
          channelId: message.channelId,
          userId: message.author.id
        }
      });
    });

    // 音声メッセージの処理
    this.client.on('speech', speech => {
      this.eventBus.publish({
        type: 'discord:message',
        platform: 'discord',
        data: {
          content: speech.content,
          type: 'voice',
          channelId: speech.channelId,
          userId: speech.userId
        }
      });
    });

    // LLMからの応答を処理
    this.eventBus.subscribe('llm:response', (event) => {
      if (event.platform === 'discord') {
        const { content, type, channelId } = event.data;
        const channel = this.client.channels.cache.get(channelId);
        
        if (channel?.isTextBased() && 'send' in channel) {
          if (type === 'text') {
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
        announcementChannel.send(`新しいツイート: ${event.data.content}\nhttps://twitter.com/user/status/${event.data.tweetId}`);
      }
    });

    // YouTubeの統計を処理
    this.eventBus.subscribe('youtube:stats', (event) => {
      const statsChannel = this.getStatsChannel();
      if (statsChannel) {
        statsChannel.send(`📊 YouTube統計\n登録者数: ${event.data.subscribers}\n総視聴回数: ${event.data.views}`);
      }
    });
  }

  private getAnnouncementChannel() {
    return this.client.channels.cache.get(process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID as string) as TextChannel;
  }

  private getStatsChannel() {
    return this.client.channels.cache.get(process.env.DISCORD_STATS_CHANNEL_ID as string) as TextChannel;
  }

  private async synthesizeAndPlay(channel: TextChannel, text: string) {
    // 音声合成と再生の実装
    // 例: Google Cloud Text-to-Speech APIなどを使用
  }
} 
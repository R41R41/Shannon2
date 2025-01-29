export type Platform = 'web' | 'discord' | 'minecraft' | 'twitter' | 'youtube';

export const promptTypes: PromptType[] = [
  'base_text',
  'base_voice',
  'about_today',
  'weather_to_emoji',
  'fortune',
  'discord',
  'forecast',
  'forecast_for_toyama_server',
];

export type PromptType =
  | TwitterSchedulePostEndpoint
  | 'base_text'
  | 'base_voice'
  | 'discord'
  | 'minecraft'
  | 'weather_to_emoji'
  | 'forecast_for_toyama_server'
  | 'youtube';

export type ConversationType =
  | 'text'
  | 'audio'
  | 'realtime_text'
  | 'realtime_audio'
  | 'endpoint'
  | 'log'
  | 'user_transcript';

export type RealTimeAPIEndpoint =
  | 'realtime_text_input'
  | 'realtime_text_commit'
  | 'realtime_audio_append'
  | 'realtime_audio_commit'
  | 'realtime_vad_on'
  | 'realtime_vad_off'
  | 'text_done'
  | 'audio_done';

export type TwitterSchedulePostEndpoint =
  | 'about_today'
  | 'forecast'
  | 'fortune';

export type MinecraftServerStatusEndpoint =
  | 'get_status'
  | 'start_server'
  | 'stop_server';

export type DiscordGuild =
  | 'discord:toyama_server'
  | 'discord:aiminelab_server'
  | 'discord:test_server';

export type MemoryZone =
  | 'web'
  | DiscordGuild
  | 'twitter:schedule_post'
  | 'twitter:post'
  | 'minecraft'
  | 'youtube';

export type EventType =
  | 'twitter:post_scheduled_message'
  | 'twitter:post_message'
  | 'twitter:get_message'
  | 'youtube:get_stats'
  | 'youtube:get_message'
  | 'youtube:post_message'
  | 'discord:get_message'
  | 'discord:post_message'
  | 'minecraft:get_status'
  | 'minecraft:start_server'
  | 'minecraft:stop_server'
  | 'minecraft:action'
  | 'minecraft:env_input'
  | 'minecraft:get_message'
  | 'minecraft:post_message'
  | 'web:get_message'
  | 'web:post_message'
  | 'web:log';

export interface LLMInput {
  platform: Platform;
  type: ConversationType;
  content: string;
}

export interface LLMOutput {
  type: ConversationType;
  content: string;
}

export interface TwitterMessageInput {
  platform: Platform;
  text?: string | null;
  replyId?: string | null;
  imageUrl?: string | null;
  endpoint?: TwitterSchedulePostEndpoint | null;
}

export interface WebMessageInput {
  type: ConversationType;
  text?: string | null;
  audio?: string | null;
  realtime_text?: string | null;
  realtime_audio?: string | null;
  endpoint?: RealTimeAPIEndpoint | null;
}

export type WebMonitoringOutputType = 'web:log' | 'web:searchResults';

export interface WebMonitoringOutput {
  type: WebMonitoringOutputType;
  data: ILog | ILog[];
}

export interface DiscordMessageInput {
  type: ConversationType;
  channelId: string;
  guildId: string;
  userName: string;
  guildName: DiscordGuild;
  channelName: string;
  messageId: string;
  userId: string;
  text?: string | null;
  audio?: string | null;
  realtime_audio?: string | null;
  endpoint?: RealTimeAPIEndpoint | null;
}

export interface MinecraftInput {
  type: ConversationType;
  serverName?: string | null;
  text?: string | null;
  endpoint?: RealTimeAPIEndpoint | MinecraftServerStatusEndpoint | null;
}

export interface MinecraftOutput {
  type: ConversationType;
  text?: string | null;
  endpoint?: RealTimeAPIEndpoint | null;
}

export interface TwitterMessageOutput {
  text: string;
  replyId?: string | null;
  imageUrl?: string | null;
  endpoint?: TwitterSchedulePostEndpoint | null;
}

export interface WebMessageOutput {
  type: ConversationType;
  text?: string | null;
  audio?: string | null;
  endpoint?: RealTimeAPIEndpoint | null;
}

export interface DiscordMessageOutput {
  type: ConversationType;
  guildId: string;
  channelId: string;
  text?: string | null;
  audio?: Uint8Array<ArrayBufferLike> | null;
  endpoint?: RealTimeAPIEndpoint | null;
  imageUrl?: string | null;
}

export interface ILog {
  timestamp: Date;
  memoryZone: MemoryZone;
  color: Color;
  content: string;
}

export interface Event {
  type: EventType;
  memoryZone: MemoryZone;
  data:
    | TwitterMessageInput
    | WebMessageInput
    | DiscordMessageInput
    | ILog
    | TwitterMessageOutput
    | WebMessageOutput
    | DiscordMessageOutput
    | MinecraftInput
    | MinecraftOutput;
  targetMemoryZones?: MemoryZone[];
}

export type Color =
  | 'white'
  | 'red'
  | 'green'
  | 'blue'
  | 'yellow'
  | 'magenta'
  | 'cyan';

export interface LogEntry {
  timestamp: string;
  memoryZone: string;
  color: Color;
  content: string;
}

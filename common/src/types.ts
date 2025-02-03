export type Platform = "web" | "discord" | "minecraft" | "twitter" | "youtube";

export const promptTypes: PromptType[] = [
  "base_text",
  "base_voice",
  "about_today",
  "weather_to_emoji",
  "fortune",
  "discord",
  "forecast",
  "forecast_for_toyama_server",
];

export type PromptType =
  | TwitterSchedulePostEndpoint
  | "base_text"
  | "base_voice"
  | "discord"
  | "minecraft"
  | "weather_to_emoji"
  | "forecast_for_toyama_server"
  | "youtube"
  | "planning"
  | "decision";

export type ConversationType =
  | "text"
  | "audio"
  | "realtime_text"
  | "realtime_audio"
  | "command"
  | "log"
  | "user_transcript";

export type RealTimeAPIEndpoint =
  | "realtime_text_input"
  | "realtime_text_commit"
  | "realtime_audio_append"
  | "realtime_audio_commit"
  | "realtime_vad_on"
  | "realtime_vad_off"
  | "text_done"
  | "audio_done";

export type TwitterSchedulePostEndpoint =
  | "about_today"
  | "forecast"
  | "fortune"
  | "check_replies";

export type MinecraftServerStatusEndpoint =
  | "get_status"
  | "start_server"
  | "stop_server";

export type DiscordGuild =
  | "discord:toyama_server"
  | "discord:aiminelab_server"
  | "discord:test_server";

export type MemoryZone =
  | "web"
  | DiscordGuild
  | "twitter:schedule_post"
  | "twitter:post"
  | "minecraft"
  | "youtube"
  | "scheduler";

export type EventType =
  | "llm:post_scheduled_message"
  | "llm:post_twitter_reply"
  | "twitter:status"
  | "twitter:start"
  | "twitter:stop"
  | "twitter:post_scheduled_message"
  | "twitter:post_message"
  | "twitter:check_replies"
  | "twitter:get_message"
  | "youtube:get_stats"
  | "youtube:get_message"
  | "youtube:post_message"
  | "llm:get_discord_message"
  | "discord:start"
  | "discord:stop"
  | "discord:status"
  | "discord:post_message"
  | "minecraft:get_status"
  | "minecraft:start_server"
  | "minecraft:stop_server"
  | "minecraft:action"
  | "minecraft:env_input"
  | "minecraft:get_message"
  | "minecraft:post_message"
  | "llm:get_web_message"
  | "web:post_message"
  | "scheduler:get_schedule"
  | "web:post_schedule"
  | "scheduler:call_schedule"
  | "web:log"
  | "web:status";

export interface ServiceInput {
  serviceCommand?: ServiceCommand | null;
}

export interface LLMInput {
  platform: Platform;
  type: ConversationType;
  content: string;
}

export interface LLMOutput {
  type: ConversationType;
  content: string;
}

export interface OpenAIMessageInput {
  type: ConversationType | "ping";
  text?: string | null;
  audio?: string | null;
  realtime_text?: string | null;
  realtime_audio?: string | null;
  command?: RealTimeAPIEndpoint | null;
}

export interface SearchQuery {
  startDate?: string;
  endDate?: string;
  memoryZone?: string;
  content?: string;
}

export type WebMonitoringInputType = "search" | "ping";

export interface WebMonitoringInput {
  type: WebMonitoringInputType;
  query?: SearchQuery | null;
}

export type WebMonitoringOutputType = "web:log" | "web:searchResults";

export interface WebMonitoringOutput {
  type: WebMonitoringOutputType | "pong";
  data?: ILog | ILog[];
}

export interface DiscordClientInput extends ServiceInput {
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
  command?: RealTimeAPIEndpoint | null;
}

export interface MinecraftInput {
  type: ConversationType;
  serverName?: string | null;
  text?: string | null;
  command?: RealTimeAPIEndpoint | MinecraftServerStatusEndpoint | null;
}

export interface MinecraftOutput {
  type: ConversationType;
  text?: string | null;
  command?: RealTimeAPIEndpoint | null;
}

export interface TwitterClientInput extends ServiceInput {
  text: string;
  replyId?: string | null;
  imageUrl?: string | null;
  command?: TwitterSchedulePostEndpoint | null;
}

export interface OpenAIMessageOutput {
  type: ConversationType | "pong";
  text?: string | null;
  realtime_text?: string | null;
  realtime_audio?: string | null;
  command?: RealTimeAPIEndpoint | null;
}

// スケジュール
export type WebScheduleInputType = "get_schedule" | "call_schedule";

export interface WebScheduleInput {
  type: WebScheduleInputType | "ping";
  name?: string | null;
}

export type WebScheduleOutputType = "post_schedule" | "call_schedule";

export interface WebScheduleOutput {
  type: WebScheduleOutputType | "pong";
  data?: Schedule[];
}

export interface DiscordClientOutput {
  type: ConversationType;
  guildId: string;
  channelId: string;
  text?: string | null;
  audio?: Uint8Array | null;
  command?: RealTimeAPIEndpoint | TwitterSchedulePostEndpoint | null;
  imageUrl?: string | null;
}

export interface ILog {
  timestamp: Date;
  memoryZone: MemoryZone;
  color: Color;
  content: string;
}

export type ScheduleInputType = "get_schedule" | "call_schedule";

export interface SchedulerInput extends ServiceInput {
  type: ScheduleInputType;
  name: string;
}

export interface SchedulerOutput {
  type: "post_schedule";
  data: Schedule[];
}

export interface Event {
  type: EventType;
  memoryZone: MemoryZone;
  data:
    | TwitterClientInput
    | OpenAIMessageInput
    | DiscordClientInput
    | ILog
    | TwitterClientInput
    | OpenAIMessageOutput
    | DiscordClientOutput
    | MinecraftInput
    | MinecraftOutput
    | SchedulerInput
    | SchedulerOutput
    | StatusAgentInput
    | ServiceInput;
  targetMemoryZones?: MemoryZone[];
}

export type Color =
  | "white"
  | "red"
  | "green"
  | "blue"
  | "yellow"
  | "magenta"
  | "cyan";

export interface LogEntry {
  timestamp: string;
  memoryZone: string;
  color: Color;
  content: string;
}

export interface Schedule {
  time: string;
  name: string;
  data: {
    type: EventType;
    memoryZone: MemoryZone;
    data: TwitterClientInput;
    targetMemoryZones: MemoryZone[];
  };
}

export type ServiceStatus = "running" | "stopped" | "connecting";

export type ServiceCommand = "start" | "stop" | "status";

export interface StatusAgentInput extends ServiceInput {
  service: "twitter" | "discord" | "minecraft" | "scheduler";
  status: ServiceStatus;
}

export type StatusAgentOutputType = "service:status" | "service:command";

export interface StatusAgentOutput {
  type: StatusAgentOutputType | "pong";
  service: "twitter" | "discord" | "minecraft";
  data: ServiceStatus;
}

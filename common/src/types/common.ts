import {
  TwitterClientInput,
  TwitterClientOutput,
  TwitterEventType,
  TwitterSchedulePostEndpoint,
} from "./twitter";
import {
  OpenAIMessageOutput,
  OpenAIInput,
  WebEventType,
  WebSkillInput,
} from "./web";
import {
  DiscordClientInput,
  DiscordClientOutput,
  DiscordEventType,
  DiscordGuild,
} from "./discord";
import {
  MinecraftInput,
  MinecraftOutput,
  MinecraftEventType,
} from "./minecraft";
import { YoutubeClientOutput, YoutubeEventType } from "./youtube";
import {
  MinebotOutput,
  MinebotInput,
  MinebotEventType,
  SkillParameters,
  SkillResult,
} from "./minebot";
import {
  TaskInput,
  TaskTreeState,
  EmotionType,
  TaskEventType,
} from "./taskGraph";
import {
  SchedulerInput,
  SchedulerOutput,
  SchedulerEventType,
} from "./scheduler";
import { LLMEventType, SkillInfo } from "./llm";
import { ToolEventType } from "./tools";
import { NotionClientInput, NotionClientOutput, NotionEventType } from "./notion";

export type Platform =
  | "web"
  | "discord"
  | "minecraft"
  | "scheduler"
  | "twitter"
  | "youtube"
  | "notion"
  | "minebot";

export type ConversationType =
  | "text"
  | "audio"
  | "realtime_text"
  | "realtime_audio"
  | "command"
  | "log"
  | "user_transcript";

export const promptTypes: PromptType[] = [
  "base_text",
  "base_voice",
  "about_today",
  "weather_to_emoji",
  "fortune",
  "discord",
  "forecast",
  "forecast_for_toyama_server",
  "reply_twitter_comment",
  "emotion",
  "use_tool",
];

export type PromptType =
  | TwitterSchedulePostEndpoint
  | "base_text"
  | "base_voice"
  | "discord"
  | "minecraft"
  | "weather_to_emoji"
  | "forecast_for_toyama_server"
  | "reply_youtube_comment"
  | "planning"
  | "reply_twitter_comment"
  | "emotion"
  | "use_tool";

export type RealTimeAPIEndpoint =
  | "realtime_text_input"
  | "realtime_text_commit"
  | "realtime_audio_append"
  | "realtime_audio_commit"
  | "realtime_vad_on"
  | "realtime_vad_off"
  | "text_done"
  | "audio_done";

export type ServiceStatus = "running" | "stopped" | "connecting";

export type ServiceCommand = "start" | "stop" | "status";

export interface ServiceInput {
  serviceCommand?: ServiceCommand | null;
  serverName?: string | null;
}

export interface ServiceOutput {
  status?: ServiceStatus | null;
}

export interface StatusAgentInput extends ServiceInput {
  service: Platform;
  status: ServiceStatus;
}

export type MemoryZone =
  | "web"
  | DiscordGuild
  | "twitter:schedule_post"
  | "twitter:post"
  | "minecraft"
  | "youtube"
  | "scheduler"
  | "minebot"
  | "null"
  | "notion";

export type EventType =
  | TaskEventType
  | TwitterEventType
  | YoutubeEventType
  | MinecraftEventType
  | DiscordEventType
  | LLMEventType
  | WebEventType
  | SchedulerEventType
  | MinebotEventType
  | ToolEventType
  | NotionEventType;

export interface Event {
  type: EventType;
  memoryZone: MemoryZone;
  data:
  | TwitterClientInput
  | TwitterClientOutput
  | OpenAIInput
  | DiscordClientInput
  | ILog
  | OpenAIMessageOutput
  | DiscordClientOutput
  | MinecraftInput
  | MinecraftOutput
  | SchedulerInput
  | SchedulerOutput
  | StatusAgentInput
  | ServiceInput
  | YoutubeClientOutput
  | MinebotOutput
  | MinebotInput
  | ServiceOutput
  | TaskInput
  | TaskTreeState
  | EmotionType
  | SkillInfo[]
  | WebSkillInput
  | SkillParameters
  | SkillResult
  | NotionClientInput
  | NotionClientOutput;
  targetMemoryZones?: MemoryZone[];
}

export interface ILog {
  timestamp: Date;
  memoryZone: MemoryZone;
  color: Color;
  content: string;
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

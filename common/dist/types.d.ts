export type Platform = "web" | "discord" | "minecraft" | "scheduler" | "twitter" | "youtube" | "minebot";
export declare const promptTypes: PromptType[];
export type PromptType = TwitterSchedulePostEndpoint | "base_text" | "base_voice" | "discord" | "minecraft" | "weather_to_emoji" | "forecast_for_toyama_server" | "reply_youtube_comment" | "planning" | "decision" | "reply_twitter_comment";
export type ConversationType = "text" | "audio" | "realtime_text" | "realtime_audio" | "command" | "log" | "user_transcript";
export type RealTimeAPIEndpoint = "realtime_text_input" | "realtime_text_commit" | "realtime_audio_append" | "realtime_audio_commit" | "realtime_vad_on" | "realtime_vad_off" | "text_done" | "audio_done";
export type TwitterSchedulePostEndpoint = "about_today" | "forecast" | "fortune" | "check_replies";
export type MinecraftServerEndpoint = "status" | "start" | "stop";
export type DiscordGuild = "discord:toyama_server" | "discord:aiminelab_server" | "discord:test_server";
export type MemoryZone = "web" | DiscordGuild | "twitter:schedule_post" | "twitter:post" | "minecraft" | "youtube" | "scheduler" | "minebot";
export type EventType = "llm:post_scheduled_message" | "llm:post_twitter_reply" | "llm:reply_youtube_comment" | "twitter:status" | "twitter:start" | "twitter:stop" | "twitter:post_scheduled_message" | "twitter:post_message" | "twitter:check_replies" | "twitter:get_message" | "youtube:get_stats" | "youtube:get_message" | "youtube:post_message" | "youtube:check_comments" | "youtube:reply_comment" | "llm:get_discord_message" | "discord:start" | "discord:stop" | "discord:status" | "discord:post_message" | "minecraft:status" | "minecraft:start" | "minecraft:stop" | `minecraft:${MinecraftServerName}:status` | `minecraft:${MinecraftServerName}:start` | `minecraft:${MinecraftServerName}:stop` | "minecraft:action" | "minecraft:env_input" | "minecraft:get_message" | "minecraft:post_message" | "llm:get_web_message" | "web:post_message" | "scheduler:get_schedule" | "web:post_schedule" | "scheduler:call_schedule" | "web:log" | "web:status" | "youtube:status" | `minebot:${string}`;
export interface ServiceInput {
    serviceCommand?: ServiceCommand | null;
}
export interface ServiceOutput {
    status?: ServiceStatus | null;
}
export interface YoutubeClientInput extends ServiceInput {
    videoId?: string | null;
    commentId?: string | null;
    reply?: string | null;
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
export interface RecentMessage {
    name: string;
    content: string;
    timestamp: number;
    imageUrl?: string[];
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
    recentMessages?: RecentMessage[] | null;
}
export interface TwitterClientInput extends ServiceInput {
    text: string;
    replyId?: string | null;
    imageUrl?: string | null;
    command?: TwitterSchedulePostEndpoint | null;
}
export interface TwitterClientOutput extends ServiceInput {
    text: string;
    replyId?: string | null;
    authorName?: string | null;
    myTweet?: string | null;
}
export interface OpenAIMessageOutput {
    type: ConversationType | "pong";
    text?: string | null;
    realtime_text?: string | null;
    realtime_audio?: string | null;
    command?: RealTimeAPIEndpoint | null;
}
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
export interface MinebotOutput {
    success?: boolean | null;
    result?: string | null;
    skillName?: string | null;
    senderName?: string | null;
    message?: string | null;
    senderPosition?: string | null;
    botPosition?: string | null;
    botHealth?: string | null;
    botFoodLevel?: string | null;
}
export interface MinebotInput {
    skillName?: string | null;
    text?: string | null;
}
export type MinecraftServerName = "1.19.0-youtube" | "1.19.0-test" | "1.19.0-play";
export interface MinecraftInput {
    serverName?: MinecraftServerName | null;
    command?: MinecraftServerEndpoint | null;
}
export interface MinecraftOutput {
    serverName?: MinecraftServerName | null;
    success?: boolean | null;
    message?: string | null;
    statuses?: {
        serverName: MinecraftServerName;
        status: boolean;
    }[] | null;
}
export interface Event {
    type: EventType;
    memoryZone: MemoryZone;
    data: TwitterClientInput | TwitterClientOutput | OpenAIMessageInput | DiscordClientInput | ILog | OpenAIMessageOutput | DiscordClientOutput | MinecraftInput | MinecraftOutput | SchedulerInput | SchedulerOutput | StatusAgentInput | ServiceInput | YoutubeClientOutput | MinebotOutput | MinebotInput | ServiceOutput;
    targetMemoryZones?: MemoryZone[];
}
export type Color = "white" | "red" | "green" | "blue" | "yellow" | "magenta" | "cyan";
export interface LogEntry {
    timestamp: string;
    memoryZone: string;
    color: Color;
    content: string;
}
export interface YoutubeClientOutput {
    videoId: string;
    commentId: string;
    text: string;
    authorName: string;
    publishedAt: string;
    videoTitle: string;
    videoDescription: string;
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
    service: Platform;
    status: ServiceStatus;
}
export type StatusAgentOutputType = "service:status" | "service:command";
export interface StatusAgentOutput {
    type: StatusAgentOutputType | "pong";
    service: "twitter" | "discord" | "minecraft" | `minecraft:${MinecraftServerName}`;
    data: ServiceStatus;
}

import { ConversationType, RealTimeAPIEndpoint, ServiceStatus, ILog } from "./common";
import { MinecraftServerName } from "./minecraft";
import { Schedule } from "./scheduler";
export interface OpenAIMessageInput {
    type: ConversationType | "ping";
    text?: string | null;
    audio?: string | null;
    realtime_text?: string | null;
    realtime_audio?: string | null;
    command?: RealTimeAPIEndpoint | null;
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
export type StatusAgentOutputType = "service:status" | "service:command";
export interface StatusAgentOutput {
    type: StatusAgentOutputType | "pong";
    service: "twitter" | "discord" | "minecraft" | `minecraft:${MinecraftServerName}`;
    data: ServiceStatus;
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
export type WebEventType = "web:post_message" | "web:post_schedule" | "web:log" | "web:planning" | "web:emotion" | "web:status";

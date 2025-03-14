import { DiscordGuild, ILog, OpenAIMessageInput, OpenAIMessageOutput, RealTimeAPIEndpoint, WebMonitoringInput, WebMonitoringOutput, WebScheduleInput, WebScheduleOutput } from "./types";
export declare const isILog: (log: ILog) => log is ILog;
export declare const isDiscordGuild: (guild: DiscordGuild) => guild is DiscordGuild;
export declare const isRealTimeAPIEndpoint: (command: RealTimeAPIEndpoint) => command is RealTimeAPIEndpoint;
export declare const isOpenAIMessageInput: (message: OpenAIMessageInput) => message is OpenAIMessageInput;
export declare const isOpenAIMessageOutput: (message: OpenAIMessageOutput) => message is OpenAIMessageOutput;
export declare const isWebMonitoringInput: (message: WebMonitoringInput) => message is WebMonitoringInput;
export declare const isWebMonitoringOutput: (message: WebMonitoringOutput) => message is WebMonitoringOutput;
export declare const isWebScheduleInput: (message: WebScheduleInput) => message is WebScheduleInput;
export declare const isWebScheduleOutput: (message: WebScheduleOutput) => message is WebScheduleOutput;

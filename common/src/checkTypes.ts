import {
  DiscordGuild,
  DiscordMessageInput,
  ILog,
  OpenAIMessageInput,
  OpenAIMessageOutput,
  RealTimeAPIEndpoint,
  WebMonitoringInput,
  WebMonitoringOutput,
  WebScheduleInput,
  WebScheduleOutput,
} from "@common/types";

export const isILog = (log: ILog): log is ILog => {
  return (
    typeof log.memoryZone === "string" &&
    typeof log.content === "string" &&
    typeof log.timestamp === "string" &&
    typeof log.color === "string"
  );
};

export const isDiscordGuild = (guild: DiscordGuild): guild is DiscordGuild => {
  return (
    guild === "discord:toyama_server" ||
    guild === "discord:aiminelab_server" ||
    guild === "discord:test_server"
  );
};

export const isRealTimeAPIEndpoint = (
  endpoint: RealTimeAPIEndpoint
): endpoint is RealTimeAPIEndpoint => {
  return (
    endpoint === "realtime_text_input" ||
    endpoint === "realtime_text_commit" ||
    endpoint === "realtime_audio_append" ||
    endpoint === "realtime_audio_commit" ||
    endpoint === "realtime_vad_on" ||
    endpoint === "realtime_vad_off" ||
    endpoint === "text_done" ||
    endpoint === "audio_done"
  );
};

export const isOpenAIMessageInput = (
  message: OpenAIMessageInput
): message is OpenAIMessageInput => {
  return (
    typeof message === "object" &&
    message !== null &&
    (message.type === "text" ||
      message.type === "audio" ||
      message.type === "realtime_text" ||
      message.type === "realtime_audio" ||
      message.type === "endpoint" ||
      message.type === "ping") &&
    (message.text === undefined ||
      typeof message.text === "string" ||
      message.text === null) &&
    (message.audio === undefined ||
      typeof message.audio === "string" ||
      message.audio === null) &&
    (message.realtime_text === undefined ||
      typeof message.realtime_text === "string" ||
      message.realtime_text === null) &&
    (message.realtime_audio === undefined ||
      typeof message.realtime_audio === "string" ||
      message.realtime_audio === null) &&
    (message.endpoint === undefined ||
      isRealTimeAPIEndpoint(message.endpoint as RealTimeAPIEndpoint) ||
      message.endpoint === null)
  );
};

export const isOpenAIMessageOutput = (
  message: OpenAIMessageOutput
): message is OpenAIMessageOutput => {
  return (
    typeof message === "object" &&
    message !== null &&
    (message.type === "text" ||
      message.type === "realtime_text" ||
      message.type === "user_transcript" ||
      message.type === "audio" ||
      message.type === "realtime_audio" ||
      message.type === "endpoint" ||
      message.type === "pong") &&
    (message.text === undefined ||
      typeof message.text === "string" ||
      message.text === null) &&
    (message.realtime_text === undefined ||
      typeof message.realtime_text === "string" ||
      message.realtime_text === null) &&
    (message.realtime_audio === undefined ||
      typeof message.realtime_audio === "string" ||
      message.realtime_audio === null) &&
    (message.endpoint === undefined ||
      isRealTimeAPIEndpoint(message.endpoint as RealTimeAPIEndpoint) ||
      message.endpoint === null)
  );
};

export const isWebMonitoringInput = (
  message: WebMonitoringInput
): message is WebMonitoringInput => {
  return (
    typeof message === "object" &&
    message !== null &&
    (message.type === "search" || message.type === "ping") &&
    (message.query === undefined ||
      (typeof message.query === "object" && message.query !== null))
  );
};

export const isWebMonitoringOutput = (
  message: WebMonitoringOutput
): message is WebMonitoringOutput => {
  return (
    typeof message === "object" &&
    message !== null &&
    (message.type === "web:log" ||
      message.type === "web:searchResults" ||
      message.type === "pong") &&
    (message.data === undefined ||
      (typeof message.data === "object" && message.data !== null))
  );
};

export const isWebScheduleInput = (
  message: WebScheduleInput
): message is WebScheduleInput => {
  return (
    message.type === "get_schedule" ||
    message.type === "call_schedule" ||
    message.type === "ping"
  );
};

export const isWebScheduleOutput = (
  message: WebScheduleOutput
): message is WebScheduleOutput => {
  return (
    message.type === "post_schedule" ||
    message.type === "call_schedule" ||
    message.type === "pong"
  );
};

export const isDiscordMessageInput = (
  message: DiscordMessageInput
): message is DiscordMessageInput => {
  return (
    typeof message === "object" &&
    message !== null &&
    (message.type === "text" ||
      message.type === "audio" ||
      message.type === "realtime_audio" ||
      message.type === "endpoint") &&
    typeof message.channelId === "string" &&
    typeof message.guildId === "string" &&
    typeof message.userName === "string" &&
    isDiscordGuild(message.guildName) &&
    typeof message.channelName === "string" &&
    typeof message.messageId === "string" &&
    typeof message.userId === "string" &&
    (message.text === undefined ||
      typeof message.text === "string" ||
      message.text === null) &&
    (message.audio === undefined ||
      typeof message.audio === "string" ||
      message.audio === null) &&
    (message.realtime_audio === undefined ||
      typeof message.realtime_audio === "string" ||
      message.realtime_audio === null) &&
    (message.endpoint === undefined ||
      isRealTimeAPIEndpoint(message.endpoint as RealTimeAPIEndpoint) ||
      message.endpoint === null)
  );
};

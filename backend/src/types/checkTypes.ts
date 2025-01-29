import {
  DiscordGuild,
  DiscordMessageInput,
  RealTimeAPIEndpoint,
  WebMessageInput,
  WebMessageOutput,
} from './types';

export const isDiscordGuild = (guild: DiscordGuild): guild is DiscordGuild => {
  return (
    guild === 'discord:toyama_server' ||
    guild === 'discord:aiminelab_server' ||
    guild === 'discord:test_server'
  );
};

export const isRealTimeAPIEndpoint = (
  endpoint: RealTimeAPIEndpoint
): endpoint is RealTimeAPIEndpoint => {
  return (
    endpoint === 'realtime_text_input' ||
    endpoint === 'realtime_text_commit' ||
    endpoint === 'realtime_audio_append' ||
    endpoint === 'realtime_audio_commit' ||
    endpoint === 'realtime_vad_on' ||
    endpoint === 'realtime_vad_off' ||
    endpoint === 'text_done' ||
    endpoint === 'audio_done'
  );
};

export const isWebMessageInput = (
  message: WebMessageInput
): message is WebMessageInput => {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message.type === 'text' ||
      message.type === 'audio' ||
      message.type === 'realtime_text' ||
      message.type === 'realtime_audio' ||
      message.type === 'endpoint') &&
    (message.text === undefined ||
      typeof message.text === 'string' ||
      message.text === null) &&
    (message.audio === undefined ||
      typeof message.audio === 'string' ||
      message.audio === null) &&
    (message.realtime_text === undefined ||
      typeof message.realtime_text === 'string' ||
      message.realtime_text === null) &&
    (message.realtime_audio === undefined ||
      typeof message.realtime_audio === 'string' ||
      message.realtime_audio === null) &&
    (message.endpoint === undefined ||
      isRealTimeAPIEndpoint(message.endpoint as RealTimeAPIEndpoint) ||
      message.endpoint === null)
  );
};

export const isWebMessageOutput = (
  message: WebMessageOutput
): message is WebMessageOutput => {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message.type === 'text' ||
      message.type === 'realtime_text' ||
      message.type === 'user_transcript' ||
      message.type === 'audio' ||
      message.type === 'realtime_audio' ||
      message.type === 'endpoint') &&
    (message.text === undefined ||
      typeof message.text === 'string' ||
      message.text === null) &&
    (message.realtime_text === undefined ||
      typeof message.realtime_text === 'string' ||
      message.realtime_text === null) &&
    (message.realtime_audio === undefined ||
      typeof message.realtime_audio === 'string' ||
      message.realtime_audio === null) &&
    (message.endpoint === undefined ||
      isRealTimeAPIEndpoint(message.endpoint as RealTimeAPIEndpoint) ||
      message.endpoint === null)
  );
};

export const isDiscordMessageInput = (
  message: DiscordMessageInput
): message is DiscordMessageInput => {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message.type === 'text' ||
      message.type === 'audio' ||
      message.type === 'realtime_audio' ||
      message.type === 'endpoint') &&
    typeof message.channelId === 'string' &&
    typeof message.guildId === 'string' &&
    typeof message.userName === 'string' &&
    isDiscordGuild(message.guildName) &&
    typeof message.channelName === 'string' &&
    typeof message.messageId === 'string' &&
    typeof message.userId === 'string' &&
    (message.text === undefined ||
      typeof message.text === 'string' ||
      message.text === null) &&
    (message.audio === undefined ||
      typeof message.audio === 'string' ||
      message.audio === null) &&
    (message.realtime_audio === undefined ||
      typeof message.realtime_audio === 'string' ||
      message.realtime_audio === null) &&
    (message.endpoint === undefined ||
      isRealTimeAPIEndpoint(message.endpoint as RealTimeAPIEndpoint) ||
      message.endpoint === null)
  );
};

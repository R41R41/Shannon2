export const isILog = (log) => {
    return (typeof log.memoryZone === "string" &&
        typeof log.content === "string" &&
        typeof log.timestamp === "string" &&
        typeof log.color === "string");
};
export const isDiscordGuild = (guild) => {
    return (guild === "discord:toyama_server" ||
        guild === "discord:aiminelab_server" ||
        guild === "discord:test_server");
};
export const isRealTimeAPIEndpoint = (command) => {
    return (command === "realtime_text_input" ||
        command === "realtime_text_commit" ||
        command === "realtime_audio_append" ||
        command === "realtime_audio_commit" ||
        command === "realtime_vad_on" ||
        command === "realtime_vad_off" ||
        command === "text_done" ||
        command === "audio_done");
};
export const isOpenAIMessageInput = (message) => {
    return (typeof message === "object" &&
        message !== null &&
        (message.type === "text" ||
            message.type === "audio" ||
            message.type === "realtime_text" ||
            message.type === "realtime_audio" ||
            message.type === "command" ||
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
        (message.command === undefined ||
            isRealTimeAPIEndpoint(message.command) ||
            message.command === null));
};
export const isOpenAIMessageOutput = (message) => {
    return (typeof message === "object" &&
        message !== null &&
        (message.type === "text" ||
            message.type === "realtime_text" ||
            message.type === "user_transcript" ||
            message.type === "audio" ||
            message.type === "realtime_audio" ||
            message.type === "command" ||
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
        (message.command === undefined ||
            isRealTimeAPIEndpoint(message.command) ||
            message.command === null));
};
export const isWebMonitoringInput = (message) => {
    return (typeof message === "object" &&
        message !== null &&
        (message.type === "search" || message.type === "ping") &&
        (message.query === undefined ||
            (typeof message.query === "object" && message.query !== null)));
};
export const isWebMonitoringOutput = (message) => {
    return (typeof message === "object" &&
        message !== null &&
        (message.type === "web:log" ||
            message.type === "web:searchResults" ||
            message.type === "pong") &&
        (message.data === undefined ||
            (typeof message.data === "object" && message.data !== null)));
};
export const isWebScheduleInput = (message) => {
    return (message.type === "get_schedule" ||
        message.type === "call_schedule" ||
        message.type === "ping");
};
export const isWebScheduleOutput = (message) => {
    return (message.type === "post_schedule" ||
        message.type === "call_schedule" ||
        message.type === "pong");
};
export const isDiscordClientInput = (message) => {
    return (typeof message === "object" &&
        message !== null &&
        (message.type === "text" ||
            message.type === "audio" ||
            message.type === "realtime_audio" ||
            message.type === "command") &&
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
        (message.command === undefined ||
            isRealTimeAPIEndpoint(message.command) ||
            message.command === null));
};

export interface MinebotOutput {
    success?: boolean | null;
    result?: string | null;
    failureType?: string | null;
    recoverable?: boolean | null;
    skillName?: string | null;
    senderName?: string | null;
    message?: string | null;
    senderPosition?: string | null;
    botPosition?: string | null;
    botHealth?: string | null;
    botFoodLevel?: string | null;
}
export type MinebotStartOrStopInput = {
    serverName?: string | null;
};
export type MinebotSkillInput = {
    skillName?: string | null;
    text?: string | null;
};
export type MinebotInput = MinebotStartOrStopInput | MinebotSkillInput;
export type MinebotEventType = `minebot:${string}`;
export type SkillParameters = {
    skillParameters: any;
};
export type SkillResult = {
    success: boolean;
    result: string;
    failureType?: string;
    recoverable?: boolean;
};
export interface MinebotVoiceChatInput {
    userName: string;
    message: string;
    guildId: string;
    channelId: string;
}
export interface MinebotVoiceResponseOutput {
    guildId: string;
    channelId: string;
    responseText: string;
}

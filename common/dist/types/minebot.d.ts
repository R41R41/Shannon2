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
export type MinebotStartOrStopInput = {
    serverName?: string | null;
};
export type MinebotSkillInput = {
    skillName?: string | null;
    text?: string | null;
};
export type MinebotInput = MinebotStartOrStopInput | MinebotSkillInput;
export type MinebotEventType = `minebot:${string}`;

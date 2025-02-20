import { ServiceInput } from "./common";
export type TwitterSchedulePostEndpoint = "about_today" | "forecast" | "fortune" | "check_replies";
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
export type TwitterEventType = "twitter:status" | "twitter:start" | "twitter:stop" | "twitter:post_scheduled_message" | "twitter:post_message" | "twitter:check_replies" | "twitter:get_message";

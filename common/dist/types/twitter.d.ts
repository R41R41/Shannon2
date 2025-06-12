import { ServiceInput } from "./common";
export type TwitterSchedulePostEndpoint = "about_today" | "news_today" | "forecast" | "fortune" | "check_replies";
export interface TwitterClientInput extends ServiceInput {
    text: string;
    tweetId?: string | null;
    replyId?: string | null;
    imageUrl?: string | null;
    command?: TwitterSchedulePostEndpoint | null;
}
export interface TwitterClientOutput extends ServiceInput {
    text: string;
    replyId?: string | null;
    myTweet?: string | null;
    createdAt?: string | null;
    retweetCount?: number | null;
    replyCount?: number | null;
    likeCount?: number | null;
    authorId?: string | null;
    authorName?: string | null;
    mediaUrl?: string | null;
}
export interface TwitterReplyOutput extends ServiceInput {
    replyId: string;
    text: string;
    authorName: string;
    repliedTweet?: string | null;
    repliedTweetAuthorName?: string | null;
}
export type TwitterEventType = "twitter:status" | "twitter:start" | "twitter:stop" | "twitter:post_scheduled_message" | "twitter:post_message" | "twitter:check_replies" | "twitter:get_message" | "twitter:get_tweet_content";

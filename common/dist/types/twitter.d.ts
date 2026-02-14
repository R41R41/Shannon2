import { ServiceInput } from "./common.js";
export type TwitterSchedulePostEndpoint = "about_today" | "news_today" | "forecast" | "fortune" | "check_replies";
export interface TwitterClientInput extends ServiceInput {
    text: string;
    tweetId?: string | null;
    replyId?: string | null;
    imageUrl?: string | null;
    command?: TwitterSchedulePostEndpoint | null;
    /** 引用RTする場合の元ツイートURL (e.g. https://x.com/user/status/123) */
    quoteTweetUrl?: string | null;
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
export interface TwitterQuoteRTOutput extends ServiceInput {
    /** 引用RTする元ツイートのID */
    tweetId: string;
    /** 引用RTする元ツイートのURL */
    tweetUrl: string;
    /** 元ツイートのテキスト */
    text: string;
    /** 元ツイートの著者名 */
    authorName: string;
    /** 元ツイートの著者ユーザー名 */
    authorUserName: string;
}
/** ツールからの操作結果 */
export interface TwitterActionResult extends ServiceInput {
    success: boolean;
    message: string;
}
export type TwitterEventType = "twitter:status" | "twitter:start" | "twitter:stop" | "twitter:post_scheduled_message" | "twitter:post_message" | "twitter:post_quote_tweet" | "twitter:like_tweet" | "twitter:retweet_tweet" | "twitter:quote_retweet" | "twitter:check_replies" | "twitter:get_message" | "twitter:get_tweet_content";

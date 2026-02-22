import { ServiceInput } from "./common.js";

export type TwitterSchedulePostEndpoint =
  | "about_today"
  | "news_today"
  | "forecast"
  | "fortune"
  | "check_replies";

export interface TwitterClientInput extends ServiceInput {
  text: string;
  tweetId?: string | null;
  replyId?: string | null;
  imageUrl?: string | null;
  command?: TwitterSchedulePostEndpoint | null;
  /** 引用RTする場合の元ツイートURL (e.g. https://x.com/user/status/123) */
  quoteTweetUrl?: string | null;
  /** 自動投稿のトピック（重複回避に使用） */
  topic?: string | null;
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
  /** リプライ主の Twitter ユーザーID (記憶システム用) */
  authorId?: string | null;
  repliedTweet?: string | null;
  repliedTweetAuthorName?: string | null;
  /** 会話スレッド (古い順)。inReplyToId チェーンを遡って取得 */
  conversationThread?: Array<{ authorName: string; text: string }> | null;
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

/** twitterapi.io トレンドデータ */
export interface TwitterTrendData {
  name: string;
  query: string;
  rank: number;
  metaDescription?: string;
}

/** メンバーツイートへのFCA応答用データ */
export interface MemberTweetInput extends ServiceInput {
  tweetId: string;
  tweetUrl: string;
  text: string;
  authorName: string;
  authorUserName: string;
  authorId?: string | null;
  repliedTweet?: string | null;
  repliedTweetAuthorName?: string | null;
  conversationThread?: Array<{ authorName: string; text: string }> | null;
}

/** 自動投稿モード */
export type AutoTweetMode = 'original' | 'trend' | 'watchlist' | 'big_account_quote';

/** 自動投稿用イベントデータ */
export interface TwitterAutoTweetInput extends ServiceInput {
  mode: AutoTweetMode;
  trends: TwitterTrendData[];
  todayInfo: string;
  recentPosts?: string[];
  recentQuoteUrls?: string[];
  recentTopics?: string[];
}

export type TwitterEventType =
  | "twitter:status"
  | "twitter:start"
  | "twitter:stop"
  | "twitter:post_scheduled_message"
  | "twitter:post_message"
  | "twitter:post_quote_tweet"
  | "twitter:like_tweet"
  | "twitter:retweet_tweet"
  | "twitter:quote_retweet"
  | "twitter:check_replies"
  | "twitter:get_message"
  | "twitter:get_tweet_content";

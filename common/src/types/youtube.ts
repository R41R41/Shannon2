import { ServiceInput } from "./common";

export interface YoutubeClientInput extends ServiceInput {
  videoId?: string | null;
  commentId?: string | null;
  reply?: string | null;
}

export type YoutubeClientOutput =
  | YoutubeCommentOutput
  | YoutubeSubscriberUpdateOutput
  | YoutubeVideoInfoOutput;

export interface YoutubeCommentOutput extends ServiceInput {
  videoId: string;
  commentId: string;
  text: string;
  authorName: string;
  publishedAt: string;
  videoTitle: string;
  videoDescription: string;
}

export interface YoutubeVideoInfoOutput extends ServiceInput {
  title: string;
  author: string;
  thumbnail: string;
  description: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}

export interface YoutubeSubscriberUpdateOutput extends ServiceInput {
  subscriberCount: number;
}

export type YoutubeEventType =
  | "youtube:get_stats"
  | "youtube:get_message"
  | "youtube:post_message"
  | "youtube:check_comments"
  | "youtube:check_subscribers"
  | "youtube:reply_comment"
  | "youtube:status"
  | "youtube:subscriber_update"
  | "youtube:get_video_info";

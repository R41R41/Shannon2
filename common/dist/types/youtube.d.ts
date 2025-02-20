import { ServiceInput } from "./common";
export interface YoutubeClientInput extends ServiceInput {
    videoId?: string | null;
    commentId?: string | null;
    reply?: string | null;
}
export interface YoutubeClientOutput {
    videoId: string;
    commentId: string;
    text: string;
    authorName: string;
    publishedAt: string;
    videoTitle: string;
    videoDescription: string;
}
export type YoutubeEventType = "youtube:get_stats" | "youtube:get_message" | "youtube:post_message" | "youtube:check_comments" | "youtube:reply_comment" | "youtube:status";

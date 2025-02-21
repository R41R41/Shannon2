import { ConversationType, Platform } from "./common";

export interface LLMInput {
  platform: Platform;
  type: ConversationType;
  content: string;
}

export interface LLMOutput {
  type: ConversationType;
  content: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  parameters: {
    name: string;
    description: string;
  }[];
}

export type LLMEventType =
  | "llm:post_scheduled_message"
  | "llm:post_twitter_reply"
  | "llm:reply_youtube_comment"
  | "llm:get_discord_message"
  | "llm:get_web_message"
  | "llm:get_skills";

import { ServiceInput, ServiceOutput } from "./common";
import { TwitterSchedulePostEndpoint } from "./twitter";
import { BaseMessage } from "@langchain/core/messages";
export type DiscordGuild =
  | "discord:toyama_server"
  | "discord:douki_server"
  | "discord:aiminelab_server"
  | "discord:test_server";

export interface DiscordGetServerEmojiInput extends ServiceInput {
  guildId: string;
}

export interface DiscordSendServerEmojiInput extends ServiceInput {
  guildId: string;
  channelId: string;
  messageId: string;
  emojiId: string;
}

export interface DiscordSendTextMessageInput extends ServiceInput {
  channelId: string;
  guildId: string;
  text: string;
}

export interface DiscordScheduledPostInput extends ServiceInput {
  command: TwitterSchedulePostEndpoint;
  text: string;
}

export type DiscordClientInput =
  | DiscordGetServerEmojiInput
  | DiscordSendServerEmojiInput
  | DiscordSendTextMessageInput
  | DiscordScheduledPostInput;

export interface DiscordGetServerEmojiOutput extends ServiceOutput {
  emojis: string[];
}

export interface DiscordSendServerEmojiOutput extends ServiceOutput {
  isSuccess: boolean;
  errorMessage: string;
}

export interface DiscordSendTextMessageOutput extends ServiceOutput {
  type: "text";
  guildName: string;
  channelName: string;
  guildId: string;
  channelId: string;
  messageId: string;
  userId: string;
  userName: string;
  text: string;
  recentMessages: BaseMessage[];
}

export type DiscordClientOutput =
  | DiscordGetServerEmojiOutput
  | DiscordSendTextMessageOutput
  | DiscordSendServerEmojiOutput;

export type DiscordEventType =
  | "discord:start"
  | "discord:stop"
  | "discord:status"
  | "discord:post_message"
  | "discord:scheduled_post"
  | "discord:get_server_emoji"
  | "discord:send_server_emoji";

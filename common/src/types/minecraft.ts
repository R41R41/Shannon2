export type MinecraftServerEndpoint = "status" | "start" | "stop";

export type MinecraftServerName =
  | "1.19.0-youtube"
  | "1.21.4-test"
  | "1.21.1-play";

export interface MinecraftInput {
  serverName?: MinecraftServerName | null;
  command?: MinecraftServerEndpoint | null;
}

export interface MinecraftOutput {
  serverName?: MinecraftServerName | null;
  success?: boolean | null;
  message?: string | null;
  statuses?: { serverName: MinecraftServerName; status: boolean }[] | null;
}

export type MinecraftEventType =
  | "minecraft:status"
  | "minecraft:start"
  | "minecraft:stop"
  | `minecraft:${MinecraftServerName}:status`
  | `minecraft:${MinecraftServerName}:start`
  | `minecraft:${MinecraftServerName}:stop`
  | "minecraft:action"
  | "minecraft:env_input"
  | "minecraft:get_message"
  | "minecraft:post_message";

import { DiscordGuild } from '@shannon/common';
import { config } from '../config/env.js';

const DISCORD_GUILD_ID_TOYAMA_SERVER = config.discord.guilds.toyama.guildId;
const DISCORD_GUILD_ID_DOUKI_SERVER = config.discord.guilds.douki.guildId;
const DISCORD_GUILD_ID_AIMINELAB_SERVER = config.discord.guilds.aimine.guildId;
const DISCORD_GUILD_ID_TEST_SERVER = config.discord.guilds.test.guildId;
const DISCORD_GUILD_ID_COLAB_SERVER = config.discord.guilds.colab.guildId;

export const getDiscordMemoryZone = async (
  guildId: string
): Promise<DiscordGuild> => {
  if (guildId === DISCORD_GUILD_ID_TOYAMA_SERVER) {
    return 'discord:toyama_server';
  }
  if (guildId === DISCORD_GUILD_ID_DOUKI_SERVER) {
    return 'discord:douki_server';
  }
  if (guildId === DISCORD_GUILD_ID_AIMINELAB_SERVER) {
    return 'discord:aiminelab_server';
  }
  if (guildId === DISCORD_GUILD_ID_TEST_SERVER) {
    return 'discord:test_server';
  }
  if (guildId === DISCORD_GUILD_ID_COLAB_SERVER) {
    return 'discord:colab_server';
  } else {
    throw new Error(`Invalid guild id: ${guildId}`);
  }
};

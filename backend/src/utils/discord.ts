import { DiscordGuild } from '@shannon/common';
import dotenv from 'dotenv';

dotenv.config();

const DISCORD_GUILD_ID_TOYAMA_SERVER = process.env.TOYAMA_GUILD_ID;
const DISCORD_GUILD_ID_DOUKI_SERVER = process.env.DOUKI_GUILD_ID;
const DISCORD_GUILD_ID_AIMINELAB_SERVER = process.env.AIMINE_GUILD_ID;
const DISCORD_GUILD_ID_TEST_SERVER = process.env.TEST_GUILD_ID;
const DISCORD_GUILD_ID_COLAB_SERVER = process.env.COLAB_GUILD_ID;

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

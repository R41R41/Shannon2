import { DiscordGuild } from '../types/types.js';

export const getDiscordMemoryZone = (guildId: string): DiscordGuild => {
  if (guildId === 'Toyama Server') {
    return 'discord:toyama_server';
  }
  if (guildId === 'Aiminelab Server') {
    return 'discord:aiminelab_server';
  }
  if (guildId === 'Test Server') {
    return 'discord:test_server';
  } else {
    throw new Error('Invalid guild name');
  }
};

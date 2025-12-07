/**
 * MemoryZone から TaskContext への変換ヘルパー
 * @deprecated 将来的にはTaskContextを直接使用してください
 */
export function memoryZoneToContext(memoryZone, channelId) {
    if (memoryZone === 'web') {
        return { platform: 'web' };
    }
    if (memoryZone.startsWith('discord:')) {
        return {
            platform: 'discord',
            discord: {
                guildName: memoryZone.replace('discord:', ''),
                channelId,
            },
        };
    }
    if (memoryZone.startsWith('twitter:')) {
        return { platform: 'twitter' };
    }
    if (memoryZone === 'youtube') {
        return { platform: 'youtube' };
    }
    if (memoryZone === 'minecraft' || memoryZone === 'minebot') {
        return { platform: memoryZone };
    }
    if (memoryZone === 'notion') {
        return { platform: 'notion' };
    }
    return { platform: 'web' };
}
/**
 * TaskContext から MemoryZone への変換ヘルパー
 * @deprecated 将来的にはTaskContextを直接使用してください
 */
export function contextToMemoryZone(context) {
    if (context.platform === 'discord' && context.discord?.guildName) {
        return `discord:${context.discord.guildName}`;
    }
    if (context.platform === 'twitter') {
        return 'twitter:post';
    }
    return context.platform;
}
export const promptTypes = [
    'base_text',
    'base_voice',
    'about_today',
    'news_today',
    'weather_to_emoji',
    'fortune',
    'discord',
    'forecast',
    'forecast_for_toyama_server',
    'reply_twitter_comment',
    'emotion',
    'use_tool',
];

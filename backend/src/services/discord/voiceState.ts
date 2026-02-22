/**
 * Channel IDs currently being processed for voice responses.
 * When set, the discord:post_message handler skips normal text posting
 * for these channels, as the voice response handler will post instead.
 */
export const voiceResponseChannelIds = new Set<string>();

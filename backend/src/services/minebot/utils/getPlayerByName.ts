import { Player } from 'mineflayer';
import { CustomBot } from '../types.js';

export function getPlayerByName(
    bot: CustomBot,
    entity_name: string
): Player | null {
    const player = Object.values(bot.players).find((player) => {
        return player.username === entity_name;
    });
    if (!player) return null;
    return player;
}

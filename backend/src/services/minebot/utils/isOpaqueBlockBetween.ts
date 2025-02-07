import { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { CustomBot } from '../types.js';

export function isOpaqueBlockBetween(
  bot: CustomBot,
  start: Vec3,
  end: Vec3
): boolean {
  try {
    const blockBetween = bot.world.raycast(start, end, 5, (block: Block) => {
      return (
        block &&
        block.boundingBox !== 'empty' &&
        block.name !== 'water' &&
        block.name !== 'air'
      );
    });
    return !!blockBetween;
  } catch (error) {
    console.error('非透過ブロックの判定に失敗しました:', error);
    return false;
  }
}

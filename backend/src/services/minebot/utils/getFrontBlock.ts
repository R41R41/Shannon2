import { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { CustomBot } from '../types.js';

export function getFrontBlock(bot: CustomBot, distance: number): Block | null {
  const { yaw, pitch } = bot.entity;
  const directionVector = new Vec3(
    -Math.sin(yaw) * Math.cos(pitch),
    -Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch)
  );

  const eyePosition = bot.entity.position.offset(0, bot.entity.height * 0.8, 0);
  const targetPosition = eyePosition.plus(directionVector.scaled(distance));
  const frontBlock = bot.blockAt(targetPosition);
  return frontBlock;
}

import { Vec3 } from 'vec3';
import { CustomBot } from '../types.js';

export async function runFromCoordinate(
  bot: CustomBot,
  coordinate: Vec3,
  distance: number
) {
  // 平均位置から逆方向に逃げる
  const escapeDirection = bot.entity.position
    .clone()
    .subtract(coordinate)
    .normalize();
  const targetPosition = bot.entity.position
    .clone()
    .add(escapeDirection.scale(distance));
  bot.setControlState('sprint', true);
  await bot.utils.goalXZ.run(targetPosition.x, targetPosition.z);
  bot.setControlState('sprint', false);
}

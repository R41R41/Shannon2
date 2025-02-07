import { Entity } from 'prismarine-entity';
import { Vec3 } from 'vec3';
import { CustomBot } from '../types.js';

export async function runFromEntities(
  bot: CustomBot,
  entities: Entity[],
  distance: number
) {
  let sumPosition = new Vec3(0, 0, 0);
  for (let entity of entities) {
    sumPosition.add(entity.position);
  }
  const averagePosition = sumPosition.scaled(1 / entities.length);

  // 平均位置から逆方向に逃げる
  const escapeDirection = bot.entity.position
    .clone()
    .subtract(averagePosition)
    .normalize();
  const targetPosition = bot.entity.position
    .clone()
    .add(escapeDirection.scale(distance));
  bot.setControlState('sprint', true);
  await bot.utils.goalXZ.run(targetPosition.x, targetPosition.z);
  bot.setControlState('sprint', false);
}

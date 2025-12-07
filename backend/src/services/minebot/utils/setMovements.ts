import { Bot } from 'mineflayer';
import pathfinder from 'mineflayer-pathfinder';
import { CustomBot } from '../types.js';
const { Movements } = pathfinder;

export function setMovements(
  bot: CustomBot,
  allow1by1towers = false,
  allowSprinting = true,
  allowParkour = true,
  canOpenDoors = true,
  canDig = true,
  dontMineUnderFallingBlock = true,
  digCost = 1,
  allowFreeMotion = false,
  canSwim = true
) {
  const defaultMove = new Movements(bot as Bot);
  defaultMove.allow1by1towers = allow1by1towers;
  defaultMove.allowSprinting = allowSprinting;
  defaultMove.allowParkour = allowParkour;
  defaultMove.canOpenDoors = canOpenDoors;
  defaultMove.canDig = canDig;
  defaultMove.dontMineUnderFallingBlock = dontMineUnderFallingBlock;
  defaultMove.digCost = digCost;
  defaultMove.allowFreeMotion = allowFreeMotion;
  (defaultMove as any).canSwim = canSwim;
  bot.pathfinder.setMovements(defaultMove);
}

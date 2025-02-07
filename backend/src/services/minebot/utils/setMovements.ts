import { Bot } from 'mineflayer';
import { Movements } from 'mineflayer-pathfinder';
import { CustomBot } from '../types.js';

export function setMovements(
  bot: CustomBot,
  allow1by1towers = true,
  allowEntityDetection = true,
  allowSprinting = true,
  allowParkour = true,
  canOpenDoors = true,
  canDig = true,
  infiniteLiquidDropdownDistance = false,
  dontMineUnderFallingBlock = true
) {
  const defaultMove = new Movements(bot as Bot);
  defaultMove.allow1by1towers = allow1by1towers;
  defaultMove.allowEntityDetection = allowEntityDetection;
  defaultMove.allowSprinting = allowSprinting;
  defaultMove.allowParkour = allowParkour;
  defaultMove.canOpenDoors = canOpenDoors;
  defaultMove.canDig = canDig;
  defaultMove.infiniteLiquidDropdownDistance = infiniteLiquidDropdownDistance;
  defaultMove.dontMineUnderFallingBlock = dontMineUnderFallingBlock;
  bot.pathfinder.setMovements(defaultMove);
}

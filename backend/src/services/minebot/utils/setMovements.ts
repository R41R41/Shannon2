import minecraftData from 'minecraft-data';
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
  defaultMove.blocksCantBreak = new Set([minecraftData(bot.version).blocksByName['oak_door'].id, minecraftData(bot.version).blocksByName['birch_door'].id, minecraftData(bot.version).blocksByName['spruce_door'].id, minecraftData(bot.version).blocksByName['jungle_door'].id, minecraftData(bot.version).blocksByName['acacia_door'].id, minecraftData(bot.version).blocksByName['dark_oak_door'].id]);
  (defaultMove as any).canSwim = canSwim;

  // ドアを openable に追加（pathfinderデフォルトではgateのみ）
  // 注意: pathfinderにバグがあり、blockAt()がnullを返すとエラーになる
  // patch-packageで修正後に有効化する
  if (canOpenDoors) {
    const mcData = minecraftData(bot.version);
    const openable = (defaultMove as any).openable as Set<number>;

    Object.keys(mcData.blocksByName).forEach(name => {
      // 木製ドアのみ（鉄ドアは右クリックで開かない）
      if (name.includes('door') && !name.includes('iron')) {
        const block = mcData.blocksByName[name];
        if (block) {
          openable.add(block.id);
        }
      }
    });
  }

  bot.pathfinder.setMovements(defaultMove);
}

import { CustomBot } from '../types.js';
import { getChatResponse } from './getChatResponse.js';
import { getFrontBlock } from './getFrontBlock.js';
import { GetHoldingItem } from './getHoldingItem.js';
import { getNearestEntitiesByName } from './getNearestEntitiesByName.js';
import { getParams } from './getParams.js';
import { GetPathToEntity } from './getPathToEntity.js';
import { GoalBlock } from './goalBlock.js';
import { GoalDistanceEntity } from './goalDistanceEntity.js';
import { GoalFollow } from './goalFollow.js';
import { GoalXZ } from './goalXZ.js';
import { runFromCoordinate } from './runFromCoordinate.js';
import { runFromEntities } from './runFromEntities.js';
import { setMovements } from './setMovements.js';

export class Utils {
  bot: CustomBot;
  goalFollow: GoalFollow;
  getFrontBlock: typeof getFrontBlock;
  getNearestEntitiesByName: typeof getNearestEntitiesByName;
  getParams: typeof getParams;
  getChatResponse: typeof getChatResponse;
  setMovements: typeof setMovements;
  goalXZ: GoalXZ;
  runFromEntities: typeof runFromEntities;
  runFromCoordinate: typeof runFromCoordinate;
  goalDistanceEntity: GoalDistanceEntity;
  getPathToEntity: GetPathToEntity;
  goalBlock: GoalBlock;
  getHoldingItem: GetHoldingItem;
  constructor(bot: CustomBot) {
    this.bot = bot;
    this.goalFollow = new GoalFollow(bot);
    this.getFrontBlock = getFrontBlock;
    this.getNearestEntitiesByName = getNearestEntitiesByName;
    this.getParams = getParams;
    this.getChatResponse = getChatResponse;
    this.setMovements = setMovements;
    this.goalXZ = new GoalXZ(bot);
    this.runFromEntities = runFromEntities;
    this.runFromCoordinate = runFromCoordinate;
    this.goalDistanceEntity = new GoalDistanceEntity(bot);
    this.getPathToEntity = new GetPathToEntity(bot);
    this.goalBlock = new GoalBlock(bot);
    this.getHoldingItem = new GetHoldingItem(bot);
  }
}

import { CustomBot, InstantSkill } from '../types.js';
import { Entity } from 'prismarine-entity';

class RunFromEntity extends InstantSkill{
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'runFromEntity';
        this.description = 'Run from the nearest entity';
        this.params = [
            {
                type: 'string',
                name: 'entity_name',
                description: 'The name of the entity to run from'
            }
        ];
    }

    async run(entity_name: string) {
        const entity = this.bot.nearestEntity(entity => entity.displayName === entity_name);
        if (entity){
            this.bot.utils.runFromEntities(this.bot, [entity], 16);
        }
        return { success: true, result: 'Run from the nearest entity' };
    }
}

export default RunFromEntity;
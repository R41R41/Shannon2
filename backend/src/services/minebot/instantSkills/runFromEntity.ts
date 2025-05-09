import { CustomBot, InstantSkill } from '../types.js';
import { Entity } from 'prismarine-entity';

class RunFromEntity extends InstantSkill{
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'runFromEntity';
        this.description = '最も近い対象のエンティティから逃げます';
        this.params = [
            {
                type: 'string',
                name: 'entity_name',
                description: '逃げる対象のエンティティの名前'
            }
        ];
    }

    async run(entity_name: string) {
        const entity = this.bot.utils.getNearestEntitiesByName(this.bot, entity_name)[0];
        if (!entity){
            return { success: false, result: '対象のエンティティが見つかりません' };
        }
        this.bot.utils.runFromEntities(this.bot, [entity], 16);
        return { success: true, result: '最も近い対象のエンティティから逃げました' };
    }
}

export default RunFromEntity;
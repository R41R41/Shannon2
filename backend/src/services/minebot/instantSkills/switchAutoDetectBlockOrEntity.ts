import { CustomBot, InstantSkill } from '../types.js';
import { createLogger } from '../../../utils/logger.js';
const log = createLogger('Minebot:Skill:switchAutoDetectBlockOrEntity');

export class SwitchAutoDetectBlockOrEntity extends InstantSkill {
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'switch-auto-detect-block-or-entity';
        this.description = '自動でブロックやエンティティを検知する';
        this.priority = 10;
        this.params = [
            {
                name: 'enable',
                type: 'boolean',
                description: '自動でブロックやエンティティを検知する機能を有効にするかどうか',
                default: true,
            },
            {
                name: 'blockName',
                type: 'string',
                description: '検知するブロックの名前。指定しない場合はブロックを検知しない。例: iron_ore, acacia_log, crafting_tableなど',
                default: null,
            },
            {
                name: 'entityName',
                type: 'string',
                description: '検知するエンティティの名前。指定しない場合はエンティティを検知しない。例: zombie, spider, creeper, R41R41(player)など',
                default: null,
            },
            {
                name: 'searchDistance',
                type: 'number',
                description: '検知する距離。指定しない場合は64ブロック',
                default: 64,
            },
        ];
    }

    async runImpl(enable: boolean, blockName: string, entityName: string, searchDistance: number) {
        log.info(`switchAutoDetectBlockOrEntity: enable=${enable}, blockName=${blockName}, entityName=${entityName}`);
        try {
            const skill = this.bot.constantSkills.getSkill('auto-detect-block-or-entity');
            if (!skill) {
                return { success: false, result: 'スキルが見つからない' };
            }
            skill.status = enable;
            skill.args.blockName = blockName;
            skill.args.entityName = entityName;
            skill.args.searchDistance = searchDistance;
            return {
                success: true,
                result: `自動でブロックやエンティティを検知する機能を${enable ? '有効' : '無効'}にしました`,
            };
        } catch (error: any) {
            return { success: false, result: `${error.message} in ${error.stack}` };
        }
    }
}

export default SwitchAutoDetectBlockOrEntity;

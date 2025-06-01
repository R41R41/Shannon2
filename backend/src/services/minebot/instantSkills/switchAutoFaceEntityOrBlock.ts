import { CustomBot, InstantSkill } from '../types.js';

export class SwitchAutoFaceEntityOrBlock extends InstantSkill {
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'switch-auto-face-entity-or-block';
        this.description = '4ブロック以内にあるエンティティやブロックに注目する機能を有効/無効にします';
        this.priority = 10;
        this.params = [
            {
                name: 'enable',
                type: 'boolean',
                description: '4ブロック以内にあるエンティティやブロックに注目する機能を有効にするかどうか',
                default: true,
            },
        ];
    }

    async runImpl(enable: boolean) {
        console.log('switchAutoFaceEntityOrBlock', enable);
        try {
            const autoFaceUpdatedBlock = this.bot.constantSkills.getSkill('auto-face-updated-block');
            if (!autoFaceUpdatedBlock) {
                return { success: false, result: 'スキルが見つからない' };
            }
            autoFaceUpdatedBlock.status = enable;
            const autoFaceMovedEntity = this.bot.constantSkills.getSkill('auto-face-moved-entity');
            if (!autoFaceMovedEntity) {
                return { success: false, result: 'スキルが見つからない' };
            }
            autoFaceMovedEntity.status = enable;
            const autoFaceNearestEntity = this.bot.constantSkills.getSkill('auto-face-nearest-entity');
            if (!autoFaceNearestEntity) {
                return { success: false, result: 'スキルが見つからない' };
            }
            autoFaceNearestEntity.status = enable;
            return {
                success: true,
                result: `4ブロック以内にあるエンティティやブロックに注目する機能を${enable ? '有効' : '無効'
                    }にしました`,
            };
        } catch (error: any) {
            return { success: false, result: `${error.message} in ${error.stack}` };
        }
    }
}

export default SwitchAutoFaceEntityOrBlock;

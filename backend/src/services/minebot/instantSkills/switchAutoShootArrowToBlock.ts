import { CustomBot, InstantSkill } from '../types.js';

export class SwitchAutoShootArrowToBlock extends InstantSkill {
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'switch-auto-shoot-arrow-to-block';
        this.description = '指定されたブロックに自動で射撃する機能を有効/無効にします';
        this.priority = 10;
        this.params = [
            {
                name: 'enable',
                type: 'boolean',
                description: '指定されたブロックに自動で射撃する機能を有効にするかどうか',
                default: true,
            },
            {
                name: 'blockName',
                type: 'string',
                description: '射撃するブロックの名前を指定します。例: targetなど',
                default: null,
            },
        ];
    }

    async runImpl(enable: boolean, blockName: string) {
        console.log('switchAutoShootArrowToBlock', enable, blockName);
        try {
            const skill = this.bot.constantSkills.getSkill('auto-shoot-arrow-to-block');
            if (!skill) {
                return { success: false, result: 'スキルが見つからない' };
            }
            skill.status = enable;
            skill.args.blockName = blockName;
            return {
                success: true,
                result: `指定されたブロックに自動で射撃する機能を${enable ? '有効' : '無効'
                    }にしました`,
            };
        } catch (error: any) {
            return { success: false, result: `${error.message} in ${error.stack}` };
        }
    }
}

export default SwitchAutoShootArrowToBlock;

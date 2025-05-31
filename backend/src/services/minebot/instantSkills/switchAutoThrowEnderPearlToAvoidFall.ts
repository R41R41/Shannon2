import { CustomBot, InstantSkill } from '../types.js';

export class SwitchAutoThrowEnderPearlToAvoidFall extends InstantSkill {
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'switch-auto-throw-ender-pearl-to-avoid-fall';
        this.description = '落下死しそうな時に自動でエンダーパールを投げて落下ダメージを回避する機能を有効/無効にします';
        this.priority = 10;
        this.params = [
            {
                name: 'enable',
                type: 'boolean',
                description: '落下死しそうな時に自動でエンダーパールを投げて落下ダメージを回避する機能を有効にするかどうか',
                default: true,
            },
        ];
    }

    async run(enable: boolean) {
        console.log('switchAutoThrowEnderPearlToAvoidFall', enable);
        try {
            const skill = this.bot.constantSkills.getSkill('auto-throw-ender-pearl-to-avoid-fall');
            if (!skill) {
                return { success: false, result: 'スキルが見つからない' };
            }
            skill.status = enable;
            return {
                success: true,
                result: `落下死しそうな時に自動でエンダーパールを投げて落下ダメージを回避する機能を${enable ? '有効' : '無効'
                    }にしました`,
            };
        } catch (error: any) {
            return { success: false, result: `${error.message} in ${error.stack}` };
        }
    }
}

export default SwitchAutoThrowEnderPearlToAvoidFall;

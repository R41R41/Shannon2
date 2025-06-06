import { CustomBot, InstantSkill } from '../types.js';

export class SwitchConstantSkill extends InstantSkill {
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'switch-constant-skill';
        this.description = '常時実行するスキルを有効/無効にします';
        this.priority = 10;
        this.params = [
            {
                name: 'switchAutoAttackHostile',
                type: 'boolean',
                description: '敵対的なモンスターに対して自動攻撃を有効にするかどうか',
                default: true,
            },
            {
                name: 'switchAutoAvoidProjectileRange',
                type: 'boolean',
                description: 'スケルトンなどの射撃範囲の自動回避を有効にするかどうか',
                default: true,
            },
            {
                name: 'switchAutoEat',
                type: 'boolean',
                description: '自動で食べるを有効にするかどうか',
                default: true,
            },
            {
                name: 'switchAutoEquipBestToolForTargetBlock',
                type: 'boolean',
                description: 'ブロックに対する最適なツールの自動選択を有効にするかどうか',
                default: true,
            },
            {
                name: 'switchAutoFaceEntityOrBlock',
                type: 'boolean',
                description: '4ブロック以内にあるエンティティやブロックに注目する機能を有効にするかどうか',
                default: true,
            },
            {
                name: 'switchAutoPickUpItem',
                type: 'boolean',
                description: '落ちているアイテムの自動収集を有効にするかどうか',
                default: true,
            },
            {
                name: 'switchAutoRunFromHostile',
                type: 'boolean',
                description: '敵モブから自動で逃げる機能を有効にするかどうか',
                default: true,
            },
            {
                name: 'switchAutoSleep',
                type: 'boolean',
                description: '夜になったら自動で寝る機能を有効にするかどうか',
                default: true,
            },
            {
                name: 'switchAutoSwim',
                type: 'boolean',
                description: '水中に入ったら自動で泳ぐ機能を有効にするかどうか',
                default: true,
            },
            {
                name: 'switchAutoThrowEnderPearlToAvoidFall',
                type: 'boolean',
                description: '落下死しそうな時に自動でエンダーパールを投げて落下ダメージを回避する機能を有効にするかどうか',
                default: true,
            },
        ];
    }

    async runImpl(switchAutoAttackHostile: boolean, switchAutoAvoidProjectileRange: boolean, switchAutoEat: boolean, switchAutoEquipBestToolForTargetBlock: boolean, switchAutoFaceEntityOrBlock: boolean, switchAutoPickUpItem: boolean, switchAutoRunFromHostile: boolean, switchAutoSleep: boolean, switchAutoSwim: boolean, switchAutoThrowEnderPearlToAvoidFall: boolean) {
        console.log('switchAutoAttackHostile', switchAutoAttackHostile);
        console.log('switchAutoAvoidProjectileRange', switchAutoAvoidProjectileRange);
        console.log('switchAutoEat', switchAutoEat);
        console.log('switchAutoEquipBestToolForTargetBlock', switchAutoEquipBestToolForTargetBlock);
        console.log('switchAutoFaceEntityOrBlock', switchAutoFaceEntityOrBlock);
        console.log('switchAutoPickUpItem', switchAutoPickUpItem);
        console.log('switchAutoRunFromHostile', switchAutoRunFromHostile);
        console.log('switchAutoSleep', switchAutoSleep);
        console.log('switchAutoSwim', switchAutoSwim);
        console.log('switchAutoThrowEnderPearlToAvoidFall', switchAutoThrowEnderPearlToAvoidFall);
        try {
            const autoAttackHostile = this.bot.constantSkills.getSkill('auto-attack-hostile');
            if (!autoAttackHostile) {
                return { success: false, result: `スキルが見つからない: auto-attack-hostile` };
            }
            autoAttackHostile.status = switchAutoAttackHostile;
            const autoAvoidProjectileRange = this.bot.constantSkills.getSkill('auto-avoid-projectile-range');
            if (!autoAvoidProjectileRange) {
                return { success: false, result: `スキルが見つからない: auto-avoid-projectile-range` };
            }
            autoAvoidProjectileRange.status = switchAutoAvoidProjectileRange;
            const autoEat = this.bot.constantSkills.getSkill('auto-eat');
            if (!autoEat) {
                return { success: false, result: `スキルが見つからない: auto-eat` };
            }
            autoEat.status = switchAutoEat;
            const autoEquipBestToolForTargetBlock = this.bot.constantSkills.getSkill('auto-equip-best-tool-for-target-block');
            if (!autoEquipBestToolForTargetBlock) {
                return { success: false, result: `スキルが見つからない: auto-equip-best-tool-for-target-block` };
            }
            autoEquipBestToolForTargetBlock.status = switchAutoEquipBestToolForTargetBlock;
            const autoFaceEntityOrBlock = this.bot.constantSkills.getSkill('auto-face-entity-or-block');
            if (!autoFaceEntityOrBlock) {
                return { success: false, result: `スキルが見つからない: auto-face-entity-or-block` };
            }
            autoFaceEntityOrBlock.status = switchAutoFaceEntityOrBlock;
            const autoPickUpItem = this.bot.constantSkills.getSkill('auto-pick-up-item');
            if (!autoPickUpItem) {
                return { success: false, result: `スキルが見つからない: auto-pick-up-item` };
            }
            autoPickUpItem.status = switchAutoPickUpItem;
            const autoRunFromHostile = this.bot.constantSkills.getSkill('auto-run-from-hostile');
            if (!autoRunFromHostile) {
                return { success: false, result: 'スキルが見つからない: auto-run-from-hostile' };
            }
            autoRunFromHostile.status = switchAutoRunFromHostile;
            const autoSleep = this.bot.constantSkills.getSkill('auto-sleep');
            if (!autoSleep) {
                return { success: false, result: 'スキルが見つからない: auto-sleep' };
            }
            autoSleep.status = switchAutoSleep;
            const autoSwim = this.bot.constantSkills.getSkill('auto-swim');
            if (!autoSwim) {
                return { success: false, result: 'スキルが見つからない: auto-swim' };
            }
            autoSwim.status = switchAutoSwim;
            const autoThrowEnderPearlToAvoidFall = this.bot.constantSkills.getSkill('auto-throw-ender-pearl-to-avoid-fall');
            if (!autoThrowEnderPearlToAvoidFall) {
                return { success: false, result: 'スキルが見つからない: auto-throw-ender-pearl-to-avoid-fall' };
            }
            autoThrowEnderPearlToAvoidFall.status = switchAutoThrowEnderPearlToAvoidFall;
            return {
                success: true,
                result: `各種常時実行スキルの状態を更新しました`,
            };
        } catch (error: any) {
            return { success: false, result: `${error.message} in ${error.stack}` };
        }
    }
}

export default SwitchConstantSkill;

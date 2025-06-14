import AttackEntity from '../instantSkills/attackEntity.js';
import HoldItem from '../instantSkills/holdItem.js';
import { ConstantSkill, CustomBot } from '../types.js';

class AutoAttackDragonPerch extends ConstantSkill {
    private holdItem: HoldItem;
    private lastAttackTime: number;
    private attackEntity: AttackEntity;

    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'auto-attack-dragon-perch';
        this.description = 'エンドラドラゴンが止まり木に止まっている時に近接攻撃します';
        this.interval = 1000;
        this.isLocked = false;
        this.priority = 10;
        this.status = true;
        this.containMovement = true;
        this.holdItem = new HoldItem(bot);
        this.lastAttackTime = 0;
        this.attackEntity = new AttackEntity(bot);
    }

    async runImpl() {
        try {
            // ボスバーの情報を取得
            const bossbarInfo = this.bot.environmentState.bossbar ?
                JSON.parse(this.bot.environmentState.bossbar) : null;

            // エンドラドラゴンのボスバーが存在しない場合は何もしない
            if (!bossbarInfo || !bossbarInfo.isDragonBar) {
                return;
            }

            // エンドラドラゴンを探す
            const dragon = this.bot.nearestEntity((entity) =>
                entity.name === 'ender_dragon' &&
                entity.position.distanceTo(this.bot.entity.position) <= 32
            );

            if (!dragon) {
                return;
            }

            // ドラゴンのY座標が低い（止まり木に止まっている）場合のみ攻撃
            if (dragon.position.y < 70) {
                const now = Date.now();
                // 1秒に1回の頻度で攻撃
                if (now - this.lastAttackTime > 1000) {
                    await this.attackEntity.run('ender_dragon', false, 1);
                    this.lastAttackTime = now;
                }
            }
        } catch (error: any) {
            console.error(`エンドラドラゴン近接攻撃中にエラー: ${error.message}`);
        }
    }
}

export default AutoAttackDragonPerch; 
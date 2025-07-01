import pathfinder from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import AttackEntity from '../instantSkills/attackEntity.js';
import HoldItem from '../instantSkills/holdItem.js';
import { ConstantSkill, CustomBot } from '../types.js';
const { goals } = pathfinder;

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
                entity.position.distanceTo(this.bot.entity.position) <= 64
            );

            if (!dragon) {
                return;
            }

            // ドラゴンのY座標が低い（止まり木に止まっている）場合のみ攻撃
            if (Number(dragon.metadata[16]) >= 3) {
                console.log('止まり木に止まっているドラゴンに近接攻撃します');
                const now = Date.now();
                // 1秒に1回の頻度で攻撃
                if (now - this.lastAttackTime > 1000) {
                    // ドラゴンの前面ではなく背後に移動
                    const dragonPos = dragon.position;
                    const dragonYaw = dragon.yaw;
                    const dragonTailPos = new Vec3(dragonPos.x - Math.sin(dragonYaw) * 3, dragonPos.y + 1.5, dragonPos.z - Math.cos(dragonYaw) * 3);
                    await this.bot.pathfinder.goto(new goals.GoalNear(dragonTailPos.x, dragonTailPos.y, dragonTailPos.z, 3));
                    await this.attackEntity.searchAndHoldWeapon(false);
                    await this.attackEntity.attackNormalOnce(dragon.id, false);
                    this.lastAttackTime = now;
                }
            }
        } catch (error: any) {
            console.error(`エンドラドラゴン近接攻撃中にエラー: ${error.message}`);
        }
    }
}

export default AutoAttackDragonPerch; 
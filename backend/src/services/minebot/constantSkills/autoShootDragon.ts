import ShootItemToEntityOrBlockOrCoordinate from '../instantSkills/shootItemToEntityOrBlockOrCoordinate.js';
import { ConstantSkill, CustomBot } from '../types.js';

class AutoShootDragon extends ConstantSkill {
    private shootSkill: ShootItemToEntityOrBlockOrCoordinate;
    private lastShootTime: number;

    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'auto-shoot-dragon';
        this.description = 'エンドラドラゴンが飛んでいる時に弓で攻撃します';
        this.interval = 1000;
        this.isLocked = false;
        this.priority = 10;
        this.status = true;
        this.containMovement = false;
        this.shootSkill = new ShootItemToEntityOrBlockOrCoordinate(bot);
        this.lastShootTime = 0;
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
                entity.position.distanceTo(this.bot.entity.position) <= 128
            );

            if (!dragon) {
                return;
            }

            // ドラゴンのY座標が高い（飛んでいる）場合のみ攻撃
            if (dragon.position.y > 70) {
                const now = Date.now();
                // 3秒に1回の頻度で攻撃
                if (now - this.lastShootTime > 3000) {
                    await this.shootSkill.run(null, 'ender_dragon', null, null);
                    this.lastShootTime = now;
                }
            }
        } catch (error: any) {
            console.error(`エンドラドラゴン攻撃中にエラー: ${error.message}`);
        }
    }
}

export default AutoShootDragon; 
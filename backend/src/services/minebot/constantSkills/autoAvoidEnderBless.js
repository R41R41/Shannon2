const ConstantSkill = require('./constantSkill.js');
const { Vec3 } = require('vec3');

class AutoAvoidEnderDragonAttack extends ConstantSkill {
    constructor(bot) {
        super(bot);
        this.skillName = 'autoAvoidEnderDragonAttack';
        this.description = 'エンダードラゴンの攻撃を自動回避する';
        this.interval = 1000;
        this.isLocked = false;
        this.status = true;
    }

    async run() {
        try {
            if (this.bot.game.dimension !== 'the_end') return;
            const fireBalls = Object.values(this.bot.entities).filter((entity) => {
                return entity.name === 'dragon_fireball';
            });

            if (fireBalls.length > 0) {
                const fireBall = fireBalls[0];
                // 落下地点を計算
                const fallPosition = this.calculatefireBallLandingPosition(
                    fireBall.position,
                    fireBall.velocity,
                    this.bot.entity.position.y
                );
                if (fallPosition) {
                    const distance = fallPosition.distanceTo(this.bot.entity.position);
                    if (distance < 10) {
                        this.bot.chat('ファイアボールを回避します');
                        await this.bot.utils.runFromCoordinate(this.bot, fallPosition, 10);
                    }
                }
            }

            const entities = Object.values(this.bot.entities).filter(
                (entity) =>
                    entity.name === 'area_effect_cloud' && entity.metadata[11].particleId === 8
            );

            if (entities.length > 0) {
                let sumPosition = new Vec3(0, 0, 0);
                for (const entity of entities) {
                    sumPosition.add(entity.position);
                }
                const averagePosition = sumPosition.scaled(1 / entities.length);
                const distance = averagePosition.distanceTo(this.bot.entity.position);
                if (distance < 10) {
                    this.bot.chat('ドラゴンブレスを回避します');
                    await this.bot.utils.runFromCoordinate(this.bot, averagePosition, 10);
                }
            }
        } catch (error) {
            console.error(error);
        }
    }

    /**
     * fireBallの落下地点を計算する
     * @param {Vec3} position - fireBallの現在位置
     * @param {Vec3} velocity - fireBallの速度
     * @param {number} targetY - 目標のY座標（プレイヤーのY座標）
     * @returns {Vec3|null} 落下地点、または計算不能な場合はnull
     */
    calculatefireBallLandingPosition(position, velocity, targetY) {
        // Y座標が目標高さに到達するまでの時間を計算
        // (targetY - position.y) = velocity.y * t
        const t = (targetY - position.y) / velocity.y;

        // 時間がマイナスの場合は既に通過している
        if (t < 0) return null;

        // X座標とZ座標を計算
        const landingX = position.x + velocity.x * t;
        const landingZ = position.z + velocity.z * t;

        return new Vec3(landingX, targetY, landingZ);
    }
}

module.exports = AutoAvoidEnderDragonAttack;

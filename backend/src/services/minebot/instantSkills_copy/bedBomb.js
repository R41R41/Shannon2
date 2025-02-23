const InstantSkill = require('./instantSkill.js');
const HoldItem = require('./holdItem.js');
const { Movements } = require('mineflayer-pathfinder');
const PlaceBlock = require('./placeBlock.js');
const { Vec3 } = require('vec3');

class BedBomb extends InstantSkill {
    /**
     * @param {import('../types.js').CustomBot} bot
     */
    constructor(bot) {
        super(bot);
        this.skillName = 'bed-bomb';
        this.description = 'ベッドを爆発させる';
        this.status = false;
        this.params = [];
        this.holdItem = new HoldItem(bot);
        this.placeBlock = new PlaceBlock(bot);
        this.headDistance = 8; // ベッド爆弾を行うドラゴンの頭の位置までの距離
    }

    async run() {
        console.log('bedBomb');
        let previousPhase = 'wait';
        try {
            while (true) {
                const enderDragon = Object.values(this.bot.entities).filter((entity) => {
                    return entity.name === 'ender_dragon';
                });
                if (enderDragon.length === 0) break;
                const bedPosition = new Vec3(1, 67, 0);
                const blockPosition = new Vec3(2, 67, 0);
                const dragonPhase = enderDragon[0].metadata[16];
                const phase =
                    dragonPhase === 2 ? 'startAttack' : dragonPhase === 3 ? 'attack' : 'wait';
                if (previousPhase !== phase) {
                    if (phase === 'startAttack') {
                        this.bot.chat('攻撃準備を開始します');
                    } else if (phase === 'attack') {
                        this.bot.chat('攻撃を開始します');
                    } else {
                        this.bot.chat('待機します');
                    }
                    previousPhase = phase;
                }
                const distance = this.bot.entity.position.distanceTo(enderDragon[0].position);
                if ((phase === 'attack' || phase === 'startAttack') && distance > 4) {
                    const distance = this.bot.entity.position.distanceTo(bedPosition);
                    if (distance > 2.5) {
                        this.bot.setControlState('sneak', false);
                        await this.setAvoidPosition();
                        await this.goToNearBedPosition(bedPosition, 2.5);
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                    } else {
                        this.bot.setControlState('sneak', true);
                        await this.bot.lookAt(blockPosition);
                        const enderDragonHeadCoordinates = await this.getEnderDragonHeadCoordinates(
                            enderDragon[0]
                        );
                        if (
                            await this.isHeadPositionNear(
                                enderDragonHeadCoordinates,
                                enderDragon[0].position,
                                bedPosition,
                                this.headDistance
                            )
                        ) {
                            await this.placeBedAndBomb(bedPosition, blockPosition);
                        } else {
                            await new Promise((resolve) => setTimeout(resolve, 10));
                        }
                    }
                } else {
                    const distance = this.bot.entity.position.distanceTo(bedPosition);
                    if (distance < 20) {
                        await this.bot.utils.runFromCoordinate(this.bot, bedPosition, 20);
                    }
                    if (distance > 30) {
                        await this.bot.utils.goalBlock.goToNear(bedPosition, 30);
                    }
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }
            }
            return { success: true, result: 'ベッド爆弾を行いました' };
        } catch (error) {
            return { success: false, result: `${error.message} in ${error.stack}` };
        }
    }

    /**
     * @param {import('../types.js').CustomEntity} enderDragon
     */
    async getEnderDragonHeadCoordinates(enderDragon) {
        const position = enderDragon.position;
        const yaw = enderDragon.yaw; // ラジアン
        const pitch = enderDragon.pitch; // ラジアン

        // yawとpitchから方向ベクトルを計算
        const dx = -Math.sin(yaw) * Math.cos(pitch);
        const dy = -Math.sin(pitch);
        const dz = Math.cos(yaw) * Math.cos(pitch);

        // 5ブロック分の距離を加える
        const headDistance = 5;
        const headPosition = new Vec3(
            position.x + dx * headDistance,
            position.y + dy * headDistance,
            position.z + dz * headDistance
        );

        return headPosition;
    }

    /**
     * @param {Vec3} bedPosition
     * @param {Vec3} blockPosition
     */
    async placeBedAndBomb(bedPosition, blockPosition) {
        // ベッドを置く
        const response = await this.placeBlock.run('white_bed', bedPosition, blockPosition);
        if (!response.success) {
            this.bot.chat(response.result);
            return;
        }
        // ベッドを爆発させる
        const bed = this.bot.findBlock({
            matching: (block) => this.bot.isABed(block),
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
        this.bot.chat('起爆します！');
        try {
            await this.bot.sleep(bed);
        } catch (error) {
            console.error('Error in sleep:', error);
        }
    }

    /**
     * @param {Vec3} headPosition
     * @param {Vec3} bedPosition
     * @param {number} dist
     */
    async isHeadPositionNear(headPosition, enderDragonPosition, bedPosition, dist) {
        const distance = headPosition.distanceTo(bedPosition);
        const distance2 = enderDragonPosition.distanceTo(bedPosition);
        return distance < dist || distance2 < dist;
    }

    /**
     * @param {Vec3} bedPosition
     * @param {number} dist
     */
    async goToNearBedPosition(bedPosition, dist) {
        const distance = this.bot.entity.position.distanceTo(bedPosition);
        if (distance > dist) {
            this.bot.utils.goalBlock.goToNear(bedPosition, dist);
        }
    }

    async setAvoidPosition() {
        try {
            const breaths = Object.values(this.bot.entities).filter(
                (entity) =>
                    entity.name === 'area_effect_cloud' && entity.metadata[11].particleId === 8
            );
            if (breaths.length === 0) {
                return;
            }
            const forbiddenPositions = [];
            for (const breath of breaths) {
                forbiddenPositions.push(breath.position);
            }
            const defaultMove = new Movements(this.bot);
            // exclusionAreasStep を設定
            defaultMove.exclusionAreasStep = [
                (block) => {
                    const pos = block.position;
                    return forbiddenPositions.some(
                        (forbidden) =>
                            pos.x === forbidden.x && pos.y === forbidden.y && pos.z === forbidden.z
                    )
                        ? 100
                        : 0; // 100 はそのブロック上を歩くことを避ける
                },
            ];
            this.bot.pathfinder.setMovements(defaultMove);
        } catch (error) {
            console.error('Error in avoidBreath:', error);
            return null;
        }
    }
}

module.exports = BedBomb;

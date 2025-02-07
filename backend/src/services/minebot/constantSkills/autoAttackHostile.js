const ConstantSkill = require("./constantSkill.js");
const AttackEntity = require("../instantSkills/attackEntity.js");
const { Vec3 } = require('vec3');
class AutoAttackHostile extends ConstantSkill{
    /**
     * @param {import('../types.js').CustomBot} bot
     */
    constructor(bot) {
        super(bot);
        this.skillName = "autoAttackHostile";
        this.description = "自動で敵モブを攻撃する";
        this.interval = 1000;
        this.distance = 24;
        this.tool_name = null;
        this.attackEntity = new AttackEntity(this.bot);
        this.status = false;
    }

    /**
         * ボットと敵対的モブの間に非透過ブロックがあるかを判定する関数
         * @param {Vec3} start - 開始座標
         * @param {Vec3} end - 終了座標
         * @returns {boolean} - 非透過ブロックがある場合はtrue、ない場合はfalse
         */
    async isOpaqueBlockBetween(start, end) {
        try {
            const direction = end.minus(start).normalize();
            let currentPos = start.clone();
    
            while (currentPos.distanceTo(end) > 1) {
                const block = this.bot.world.getBlock(currentPos);
                if (block && block.boundingBox !== 'empty' && block.name !== 'water' && block.name !== 'air') {
                    console.log("非透過ブロックを発見:", block.name);
                    return true;
                }
                currentPos.add(direction);
            }
            return false;
        } catch (error) {
            console.error("非透過ブロックの判定に失敗しました:", error);
            return false;
        }
    }

    /**
     * distance以内の敵対的モブを取得
     * @param {number} distance
     * @returns {import('../types').Entities}
     */
    async getNearestHostiles(distance) {
        const entities = Object.values(this.bot.entities).filter(entity => {
            // 敵対的モブであり、指定された距離以内にあるかをチェック
            return entity.type === 'hostile' && this.bot.entity.position.distanceTo(entity.position) <= distance;
        });
        if (entities.length === 0) return []
        // 間に非透過ブロックがない敵対的モブのみを取得
        const start = this.bot.entity.position.offset(0, this.bot.entity.height, 0);
        const hostiles = entities.filter(async entity => {
            const end = entity.position.offset(0, entity.height, 0);
            return !(await this.isOpaqueBlockBetween(start, end));
        });
        if (hostiles.length === 0) return []
        // 距離でソートして、最も近い10体の敵対的モブを取得
        const sortedEntities = hostiles.map(entity => {
            const dist = this.bot.entity.position.distanceTo(entity.position);
            return { entity, distance: dist };
        }).sort((a, b) => a.distance - b.distance);

        const nearestEntities = sortedEntities.slice(0, 10).map(item => item.entity);
        return nearestEntities;
    }

    async run() {
        const hostiles = await this.getNearestHostiles(this.distance);
        if (hostiles.length === 0) return;
        const hostile = hostiles[0];
        if (hostile) {
            console.log("敵対的モブを発見しました");
            this.bot.attackEntity = hostile;
            await this.attackEntity.attackEntityOnce(hostile, "null");
            this.bot.attackEntity = null;
        }
    }
}

module.exports = AutoAttackHostile;
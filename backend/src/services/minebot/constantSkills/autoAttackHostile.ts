import { CustomBot, ConstantSkill } from '../types.js' ;
import AttackEntity from '../instantSkills/attackEntity.js';
import { Vec3 } from 'vec3';

class AutoAttackHostile extends ConstantSkill{
    distance: number;
    tool_name: string | null;
    attackEntity: AttackEntity;
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = "autoAttackHostile";
        this.description = "自動で敵モブを攻撃する";
        this.interval = 1000;
        this.distance = 24;
        this.tool_name = null;
        this.attackEntity = new AttackEntity(this.bot);
        this.status = false;
    }

    async isOpaqueBlockBetween(start: Vec3, end: Vec3) {
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

    async getNearestHostiles(distance: number) {
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
            await this.attackEntity.attackEntityOnce(hostile.id);
            this.bot.attackEntity = null;
        }
    }
}

export default AutoAttackHostile;
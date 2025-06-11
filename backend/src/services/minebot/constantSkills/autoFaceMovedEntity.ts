import { ConstantSkill, CustomBot } from '../types.js';
import { Vec3 } from 'vec3';
import { Entity } from 'prismarine-entity';

class AutoFaceMovedEntity extends ConstantSkill {
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'auto-face-moved-entity';
        this.description = 'エンティティが移動した場合に注目します';
        this.status = false;
        this.isLocked = false;
    }

    async run(entity: Entity) {
        if (entity.name === 'item' && entity.onGround) return;
        if (this.bot.executingSkill) return;
        if (this.isLocked) return;
        this.isLocked = true;
        // エンティティの頭の位置を計算
        const headPos = new Vec3(
            entity.position.x,
            entity.position.y + (entity.height || 1.62),
            entity.position.z
        );
        await this.bot.lookAt(headPos);
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.isLocked = false;
    }
}

export default AutoFaceMovedEntity;

import { ConstantSkill, CustomBot } from '../types.js';
import { Vec3 } from 'vec3';

class AutoFaceNearestEntity extends ConstantSkill {
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'auto-face-nearest-entity';
        this.description = '8ブロック以内にある最も近いエンティティに注目します';
        this.interval = 1000;
        this.status = true;
    }

    async run() {
        // 自分自身以外のエンティティを8ブロック以内で取得
        const entities = Object.values(this.bot.entities)
            .filter(e => e.id !== this.bot.entity.id)
            .filter(e => this.bot.entity.position.distanceTo(e.position) <= 8);
        if (entities.length === 0) return;
        // 最も近いエンティティを選択
        const nearest = entities.reduce((a, b) =>
            this.bot.entity.position.distanceTo(a.position) < this.bot.entity.position.distanceTo(b.position) ? a : b
        );
        // エンティティの頭の位置を計算
        const headPos = new Vec3(
            nearest.position.x,
            nearest.position.y + (nearest.height || 1.62),
            nearest.position.z
        );
        await this.bot.lookAt(headPos);
    }
}

export default AutoFaceNearestEntity;

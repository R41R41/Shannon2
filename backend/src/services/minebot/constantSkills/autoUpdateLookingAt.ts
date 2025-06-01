import { ConstantSkill, CustomBot } from '../types.js';
import { Vec3 } from 'vec3';
import mcData from 'minecraft-data';

class AutoUpdateLookingAt extends ConstantSkill {
    private mcData: any;
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'auto-update-looking-at';
        this.description = 'lookingAtを更新します';
        this.interval = 1000;
        this.status = true;
        this.mcData = mcData(this.bot.version);
    }

    async run() {
        const block = this.bot.blockAtCursor(8);
        const entity = this.bot.entityAtCursor(8);
        if (entity) {
            if (entity.name === "item") {
                const meta = entity.metadata.find(m => m && typeof m === 'object' && 'itemId' in m);
                if (meta) {
                    const itemId = meta.itemId;
                    const itemName = this.mcData.items[itemId as number]?.name;
                    this.bot.lookingAt = {
                        isDroppedItem: true,
                        name: itemName,
                        position: entity.position ? entity.position : null,
                        metadata: entity.metadata,
                    };
                }
            } else {
                this.bot.lookingAt = entity;
            }
        } else if (block) {
            this.bot.lookingAt = block;
        } else {
            this.bot.lookingAt = null;
        }
    }
}

export default AutoUpdateLookingAt;

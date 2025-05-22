import { ConstantSkill, CustomBot } from '../types.js';
import minecraftData from 'minecraft-data';

class AutoDetectBlockOrEntity extends ConstantSkill {
    private mcData: any;
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'auto-detect-block-or-entity';
        this.description = 'ブロックやエンティティを自動で検知する';
        this.isLocked = false;
        this.status = false;
        this.interval = 1000;
        this.mcData = minecraftData(this.bot.version);
        this.args = { blockName: null, entityName: null, searchDistance: 64 };
    }

    async run() {
        this.lock();
        if (this.args[0].blockName) {
            const Block = this.mcData.blocksByName[this.args[0].blockName];
            if (!Block) {
                this.bot.chat(`ブロック${this.args[0].blockName}はありません`);
            }
            const Blocks = this.bot.findBlocks({
                matching: Block.id,
                maxDistance: this.args[2].searchDistance,
                count: 1,
            });
            if (Blocks.length > 0) {
                this.bot.chat(`周囲${this.args[2].searchDistance}ブロック以内に${this.args[0].blockName}が見つかりました`);
            }
        }
        if (this.args[1].entityName) {
            const Entities = this.bot.utils.getNearestEntitiesByName(
                this.bot,
                this.args[1].entityName
            );
            if (Entities.length > 0) {
                this.bot.chat(`周囲${this.args[2].searchDistance}ブロック以内に${this.args[1].entityName}が見つかりました`);
            }
        }
        this.unlock();
    }
}

export default AutoDetectBlockOrEntity;

import { CustomBot, InstantSkill } from '../types.js';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

class SearchAndGotoBlock extends InstantSkill{
    private mcData: any;
    private searchDistance: number;
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = "search-and-goto-block";
        this.description = "指定されたブロックを探索してその位置に移動します。";
        this.status = false;
        this.mcData = require('minecraft-data')(this.bot.version);
        this.searchDistance = 64;
        this.params = [{
            "name": "blockName",
            "description": "探索するブロック",
            "type": "string"
        }];
    }

    async run(blockName: string){
        console.log("searchBlock", blockName);
        try{
            const Block = this.mcData.blocksByName[blockName];
            if (!Block) {
                return {"success": false, "result": `ブロック${blockName}はありません`};
            }
            const Blocks = this.bot.findBlocks({
                matching: Block.id,
                maxDistance: this.searchDistance,
                count: 1
            });
            if (Blocks.length === 0){
                return {"success": false, "result": `周囲${this.searchDistance}ブロック以内に${blockName}は見つかりませんでした`};
            }
            await this.bot.pathfinder.goto( new goals.GoalNear(Blocks[0].x, Blocks[0].y, Blocks[0].z, 1));
            return {"success": true, "result": `${blockName}は${Blocks[0].x} ${Blocks[0].y} ${Blocks[0].z}にあります。`};
        } catch (error: any) {
            return {"success": false, "result": `${error.message} in ${error.stack}`};
        }
    }
}

export default SearchAndGotoBlock;
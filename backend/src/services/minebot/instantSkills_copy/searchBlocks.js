const InstantSkill = require('./instantSkill.js');
const fs = require('fs');

class SearchBlocks extends InstantSkill {
    /**
     * @param {import('../types.js').CustomBot} bot
     */
    constructor(bot) {
        super(bot);
        this.skillName = "search-blocks";
        this.description = "周囲の特定のブロック全ての位置情報を取得します。";
        this.priority = 100;
        this.canUseByCommand = false;
        this.mcData = require('minecraft-data')(this.bot.version);
        this.params = [
            {
                name: "block_name",
                description: "取得するブロックの名前",
                type: "string",
                required: false,
                default: null
            }
        ]
    }

    /**
     * @param {string} blockName
     */
    async run(blockName) {
        try {
            const blocksInfo = [];
            const path = require('path');
            const filePath = path.join(process.cwd(), '../../saves/minecraft/surrounding_blocks.txt');


            const Block = this.mcData.blocksByName[blockName];
            if (!Block) {
                return {"success": false, "result": `ブロック${blockName}はありません`};
            }
            const Blocks = this.bot.findBlocks({
                matching: Block.id,
                maxDistance: 64,
                count: 64
            });

            if (Blocks.length === 0){
                return {"success": false, "result": `周囲64ブロック以内に${blockName}は見つかりませんでした`};
            }

            Blocks.forEach(block => {
                blocksInfo.push({
                    name: blockName,
                    position: `${block.x},${block.y},${block.z}`
                });
            });
            fs.writeFileSync(filePath, JSON.stringify(blocksInfo, null, 2));
            return { 
                "success": true, 
                "result": `${blockName ? `${blockName}の` : ''}周囲のブロックのデータを以下に格納しました: ${filePath}` 
            };
        } catch (error) {
            return { "success": false, "result": `${error.message} in ${error.stack}` };
        }
    }
}

module.exports = SearchBlocks;

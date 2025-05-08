import { InstantSkill, CustomBot } from "../types.js";
import fs from 'fs';
import path from 'path';
import { Vec3 } from 'vec3';

class GetBlocksData extends InstantSkill {
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = "get-blocks-data";
        this.description = "特定の座標領域のブロックのデータを取得します。";
        this.priority = 100;
        this.canUseByCommand = false;
        this.params = [
            {
                name: "startPosition",
                description: "取得する開始座標",
                type: "Vec3",
                required: false,
                default: null
            },
            {
                name: "endPosition",
                description: "取得する終了座標",
                type: "Vec3",
                required: false,
                default: null
            }
        ]
    }

    async run(startPosition: Vec3, endPosition: Vec3) {
        try {
            const blocksInfo: { name: string; position: string; metadata: number }[] = [];
            const filePath = path.join(process.cwd(), '../../saves/minecraft/surrounding_blocks.txt');

            // 開始座標から終了座標までのブロックを取得
            for (let x = startPosition.x; x <= endPosition.x; x++) {
                for (let y = startPosition.y; y <= endPosition.y; y++) {
                    for (let z = startPosition.z; z <= endPosition.z; z++) {
                        const pos = new Vec3(x, y, z);
                        const block = this.bot.blockAt(pos);
                        if (block) {
                            blocksInfo.push({
                                name: block.name,
                                position: `${x},${y},${z}`,
                                metadata: block.metadata
                            });
                        }
                    }
                }
            }
            fs.writeFileSync(filePath, JSON.stringify(blocksInfo, null, 2));
            return { 
                "success": true, 
                "result": `周囲のブロックのデータを以下に格納しました: ${filePath}` 
            };
        } catch (error: any) {
            return { "success": false, "result": `${error.message} in ${error.stack}` };
        }
    }
}

export default GetBlocksData;

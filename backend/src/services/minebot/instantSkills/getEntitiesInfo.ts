import { CustomBot, InstantSkill } from '../types.js';
import fs from 'fs';
import { Vec3 } from 'vec3';
import path from 'path';

class GetEntitiesInfo extends InstantSkill {
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = "get-entities-info";
        this.description = "自分を含めた周囲のmob, player, hostileの位置情報を取得します。";
        this.priority = 100;
        this.canUseByCommand = false;
        this.params = []
    }

    async run() {
        try {
            const entitiesInfo: { id: string; name: string; position: Vec3 }[] = [];
            const filePath = path.join(process.cwd(), 'saves/minecraft/entities_data.json');

            const sortedEntities = Object.values(this.bot.entities)
                .filter(entity => this.bot.entity.position.distanceTo(entity.position) <= 32 && (entity.type === 'mob' || entity.type === 'player' || entity.type === 'hostile'))
                .map(entity => ({
                    entity,
                    distance: this.bot.entity.position.distanceTo(entity.position)
                }))
                .sort((a, b) => a.distance - b.distance)
                .map(item => item.entity);

            sortedEntities.forEach(entity => {
                entitiesInfo.push({
                    id: entity.id.toString(),
                    name: entity.username || entity.name || '',
                    position: entity.position
                });
            });
            
            // JSON形式でファイルに保存（すでにJSON.stringifyを使用しているため変更なし）
            fs.writeFileSync(filePath, JSON.stringify(entitiesInfo, null, 2));
            
            return { "success": true, "result": `周囲のエンティティのデータをJSON形式で ${filePath} に保存しました` };
        } catch (error: any) {
            return { "success": false, "result": `${error.message} in ${error.stack}` };
        }
    }
}

export default GetEntitiesInfo;

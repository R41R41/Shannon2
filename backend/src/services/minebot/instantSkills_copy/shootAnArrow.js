const InstantSkill = require('./instantSkill.js');
const HoldItem = require('./holdItem.js');

class ShootAnArrow extends InstantSkill {
    /**
     * @param {import('../types.js').CustomBot} bot
     */
    constructor(bot) {
        super(bot);
        this.skillName = "shoot-an-arrow";
        this.description = "指定エンティティまたは指定座標に矢を射撃します。";
        this.params = [
            {
                "name": "entityName",
                "type": "string",
                "description": "射撃するエンティティの名前を指定します。nullの場合は指定座標に射撃します。",
                "default": null
            },
            {
                "name": "coordinate",
                "type": "vec3",
                "description": "射撃する座標を指定します。エンティティが指定されている場合はこの座標に最も近いエンティティに射撃します。",
                "default": null
            }
        ]
        this.holdItem = new HoldItem(this.bot);
        this.isLocked = false;
    }

    /**
     * @param {string} entityName
     * @param {import('../types.js').Vec3} coordinate
     * @param {number} distance
     * @returns {import('../types.js').Entity}
     * @description 指定した座標からdistance以内にいるエンティティの中で最も近いエンティティを取得します。
     */
    async getNearestEntity(entityName, coordinate, distance){
        const entities = Object.values(this.bot.entities).filter(entity => {
            return entity.name === entityName && entity.position.distanceTo(coordinate) <= distance;
        });
        if (entities.length === 0) return null;
        const sortedEntities = entities.map(entity => {
            const dist = entity.position.distanceTo(coordinate);
            return { entity, distance: dist };
        }).sort((a, b) => a.distance - b.distance);
        return sortedEntities[0].entity;
    }

    /**
     * @param {string | null} entityName
     * @param {import('../types.js').Vec3} coordinate
     */
    async run(entityName, coordinate) {
        console.log("shootAnArrow:", entityName, coordinate);
        try{
            if (entityName !== null){
                const entity = await this.getNearestEntity(entityName, coordinate, 16);
                if (!entity) {
                    return {"success": false, "result": `エンティティ${entityName}は見つかりませんでした`};
                }
                await this.holdItem.run("bow","hand");
                this.bot.hawkEye.oneShot(entity, "bow");
                return {"success": true, "result": `エンティティ${entityName}に射撃しました`};
            } else {
                await this.holdItem.run("bow","hand");
                const blockPosition = {
                    position: coordinate,
                    isValid: true
                }
                this.bot.hawkEye.oneShot(blockPosition);
                return {"success": true, "result": `座標${coordinate}に射撃しました`};
            }
        } catch (error) {
            return {"success": false, "result": `${error.message} in ${error.stack}`};
        }
    }
}

module.exports = ShootAnArrow;
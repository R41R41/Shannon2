const ConstantSkill = require('./constantSkill.js');
const BedBomb = require('../instantSkills/bedBomb.js');
const { Vec3 } = require('vec3');
class TraceEnderDragonHead extends ConstantSkill{
    constructor(bot){
        super(bot);
        this.skillName = "traceEnderDragonHead";
        this.description = "エンダードラゴンの頭を追跡する";
        this.interval = 100;
        this.isLocked = false;
        this.status = false;
        this.bedBomb = new BedBomb(this.bot);
    }

    async run(){
        try{
            const enderDragonHeadCoordinates = await this.bedBomb.getEnderDragonHeadCoordinates();
            this.bot.chat(`/particle minecraft:heart ${enderDragonHeadCoordinates.x} ${enderDragonHeadCoordinates.y} ${enderDragonHeadCoordinates.z} 0 0 0 10 10 force`);
        }catch(error){
            console.error("エンダードラゴンの頭を追跡できませんでした:", error);
            this.bot.chat("エンダードラゴンの頭を追跡できませんでした");
        }
    }
}

module.exports = TraceEnderDragonHead;

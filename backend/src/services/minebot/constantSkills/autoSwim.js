const ConstantSkill = require("./constantSkill.js");
const FollowEntity = require("../instantSkills/followEntity.js");
class AutoSwim extends ConstantSkill{
    /**
     * @param {import('../types.js').CustomBot} bot
     */
    constructor(bot) {
        super(bot);
        this.skillName = "autoSwim";
        this.description = "自動で泳ぐ";
        this.interval = 1000;
        this.distance = 24;
        this.followEntity = new FollowEntity(this.bot);
        this.status = true;
    }

    async run() {
        try{
            if (this.bot.entity.isInWater) {
                await this.followEntity.swim();
            }
        }catch(error){
            console.log("autoSwim error", error);
        }
    }
}

module.exports = AutoSwim;

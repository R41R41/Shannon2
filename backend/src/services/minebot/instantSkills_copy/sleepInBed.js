const InstantSkill = require('./instantSkill.js');

class SleepInBed extends InstantSkill{
    constructor(bot){
        super(bot);
        this.skillName = "sleep-in-bed";
        this.description = "ベッドに眠ります";
        this.status = false;
    }

    async run(){
        try{
            const bed = this.bot.findBlock({
                matching: this.bot.isABed,
                maxDistance: 16 // 探索する最大距離を指定
            });

            if (bed.length === 0) {
                return {"success": false, "result": "近くにベッドが見つかりませんでした"};
            }

            try {
                await this.bot.sleep(bed);
                return {"success": true, "result": "ベッドで眠りました"};
            } catch (err) {
                return {"success": false, "result": `ベッドで眠ることができませんでした: ${err}`};
            }
        } catch (error) {
            return {"success": false, "result": `${error.message} in ${error.stack}`};
        }
    }
}

module.exports = SleepInBed;
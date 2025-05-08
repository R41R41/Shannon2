import { InstantSkill, CustomBot } from "../types.js";

class SleepInBed extends InstantSkill{
    constructor(bot: CustomBot){
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

            if (!bed) {
                return {"success": false, "result": "近くにベッドが見つかりませんでした"};
            }

            try {
                await this.bot.sleep(bed);
                return {"success": true, "result": "ベッドで眠りました"};
            } catch (error: any) {
                return {"success": false, "result": `ベッドで眠ることができませんでした: ${error.message}`};
            }
        } catch (error: any) {
            return {"success": false, "result": `${error.message} in ${error.stack}`};
        }
    }
}

export default SleepInBed;
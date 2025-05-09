import { CustomBot, InstantSkill } from '../types.js';
import pathfinder from 'mineflayer-pathfinder';
const { goals, Movements } = pathfinder;
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import { Bot } from 'mineflayer';

class SearchAndGotoBlock extends InstantSkill{
    private mcData: any;
    private searchDistance: number;
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = "search-and-goto-block";
        this.description = "指定されたブロックを探索してその位置に移動します。";
        this.status = false;
        this.mcData = minecraftData(this.bot.version);
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
            
            const targetPos = new Vec3(Blocks[0].x, Blocks[0].y, Blocks[0].z);
            
            // 移動設定を構成
            const defaultMove = new Movements(this.bot as unknown as Bot);
            defaultMove.canDig = true;
            defaultMove.digCost = 1; // 掘るコストを低めに設定
            
            // 移動設定を適用
            this.bot.pathfinder.setMovements(defaultMove);
            
            // 到達を試行する関数
            const attemptToReachGoal = async (remainingAttempts = 32, timeout = 60000) => {
                try {
                    console.log(`${blockName}へ到達を試みています... 残り試行回数: ${remainingAttempts}`);
                    
                    // タイムアウト処理
                    const timeoutPromise = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('移動タイムアウト')), timeout);
                    });
                    
                    // 目標への移動
                    const goal = new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 1);
                    const movePromise = this.bot.pathfinder.goto(goal);
                    
                    await Promise.race([movePromise, timeoutPromise]);
                    return {"success": true, "result": `${blockName}は${targetPos.x} ${targetPos.y} ${targetPos.z}にあります。`};
                } catch (moveError: any) {
                    console.log(`到達試行中にエラー: ${moveError.message}`);
                    
                    // 現在位置と目標の距離を確認
                    const currentPos = this.bot.entity.position;
                    const distance = currentPos.distanceTo(targetPos);
                    
                    // 十分近い場合（3ブロック以内）は成功と見なす
                    if (distance <= 3) {
                        return {"success": true, "result": `${blockName}は${targetPos.x} ${targetPos.y} ${targetPos.z}にあります。目標変更エラーが発生しましたが、十分に近づけました（距離: ${distance.toFixed(2)}ブロック）。`};
                    }
                    
                    // 再試行回数が残っている場合は再試行
                    if (remainingAttempts > 1) {
                        console.log(`再試行します... 距離: ${distance.toFixed(2)}ブロック`);
                        // 一時停止してから再試行
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        return attemptToReachGoal(remainingAttempts - 1, timeout);
                    } else {
                        console.log("search-and-goto-block error:", moveError);
                        return {"success": false, "result": `${blockName}へ到達できませんでした。最終距離: ${distance.toFixed(2)}ブロック`};
                    }
                }
            };
            
            // 到達試行を開始
            return await attemptToReachGoal();
        } catch (error: any) {
            return {"success": false, "result": `${error.message} in ${error.stack}`};
        }
    }
}

export default SearchAndGotoBlock;
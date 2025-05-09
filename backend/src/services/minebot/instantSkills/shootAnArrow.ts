import { CustomBot, InstantSkill } from '../types.js';
import HoldItem from './holdItem.js';
import { Vec3 } from 'vec3';

class ShootAnArrow extends InstantSkill {
    private holdItem: HoldItem;
    private isLocked: boolean;
    constructor(bot: CustomBot) {
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
                "type": "Vec3",
                "description": "射撃する座標を指定します。エンティティが指定されている場合はこの座標に最も近いエンティティに射撃します。",
                "default": null
            }
        ]
        this.holdItem = new HoldItem(this.bot);
        this.isLocked = false;
    }

    async getNearestEntity(entityName: string, coordinate: Vec3, distance: number){
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

    // hawkEyeを使用して弓を発射する
    private async shootWithHawkEye(target: any): Promise<void> {
        console.log("hawkEyeでの射撃を開始します...");
        
        // hawkEyeでターゲットを狙って発射
        this.bot.hawkEye.oneShot(target, "bow" as any);
        
        // 発射が完了するまで待機
        await new Promise(resolve => {
            let shotsLeft = 2; // 2回のイベントを待機（弓を引く＋矢を放つ）
            
            const checkStatus = () => {
                shotsLeft--;
                if (shotsLeft <= 0) {
                    this.bot.removeListener('physicsTick', checkStatus);
                    resolve(undefined);
                }
            };
            
            // 一定時間後に解決する（タイムアウト）
            const timeout = setTimeout(() => {
                this.bot.removeListener('physicsTick', checkStatus);
                // 弓が引かれたままなら強制的に解除
                try {
                    this.bot.deactivateItem();
                } catch (err) {
                    // エラーは無視
                }
                resolve(undefined);
            }, 4000);
            
            // 物理ティックごとにステータスをチェック
            this.bot.on('physicsTick', checkStatus);
        });
        
        console.log("射撃完了");
    }

    async run(entityName: string | null, coordinate: Vec3 | null) {
        console.log("shootAnArrow:", entityName, coordinate);
        try{
            if (entityName !== null){
                const entities = await this.bot.utils.getNearestEntitiesByName(this.bot, entityName);
                if (entities.length === 0) {
                    return {"success": false, "result": `エンティティ${entityName}は見つかりませんでした`};
                }
                await this.holdItem.run("bow", false);
                await this.shootWithHawkEye(entities[0]);
                return {"success": true, "result": `エンティティ${entityName}に射撃しました`};
            } else if (coordinate !== null) {
                await this.holdItem.run("bow", false);
                
                // 座標を正しくターゲットとして構成
                const targetPos = new Vec3(coordinate.x, coordinate.y, coordinate.z);
                const target = {
                    position: targetPos,
                    isValid: true,
                    velocity: { x: 0, y: 0, z: 0 },
                    height: 0.5,
                    width: 0.5,
                    onGround: true
                };
                await this.shootWithHawkEye(target);
                return {"success": true, "result": `座標${coordinate.x},${coordinate.y},${coordinate.z}に射撃しました`};
            } else {
                return {"success": false, "result": `エンティティ名または座標が指定されていません`};
            }
        } catch (error: any) {
            // エラー時に念のため右クリックを解除
            try {
                this.bot.deactivateItem();
            } catch (err) {
                // エラーは無視
            }
            return {"success": false, "result": `${error.message} in ${error.stack}`};
        }
    }
}

export default ShootAnArrow;
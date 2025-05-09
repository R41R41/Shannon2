import { Vec3 } from 'vec3';
import HoldItem from './holdItem.js';
import pathfinder from 'mineflayer-pathfinder';
const { goals } = pathfinder;
import { CustomBot, InstantSkill } from '../types.js';
import { Block } from 'prismarine-block';

class PlaceBlock extends InstantSkill {
    private holdItem: HoldItem;
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = "place-block";
        this.description = "指定したブロックを置きます。";
        this.holdItem = new HoldItem(bot);
        this.params = [
            {
                "name": "blockName",
                "type": "string",
                "description": "置くブロックの名前",
                "default": "null"
            },
            {
                "name": "placePosition",
                "type": "vec3",
                "description": "ブロックを置く座標",
                "default": "0,0,0"
            },
            {
                "name": "placedBlockPosition",
                "type": "vec3",
                "description": "ブロックを面で接するように置く先の既に置いてあるブロックの座標",
                "default": "0,0,0"
            }
        ];
    }

    async run(blockName: string, placePosition: any, placedBlockPosition: any) {
        console.log("placeBlock", blockName, placePosition, placedBlockPosition);
        try {
            // Vec3オブジェクトに変換
            const placePositionVec3 = this.parseVec3(placePosition);
            const placedBlockPositionVec3 = this.parseVec3(placedBlockPosition);
            
            if (!placePositionVec3 || !placedBlockPositionVec3) {
                return { "success": false, "result": "座標の形式が正しくありません。" };
            }

            const placeblock = this.bot.blockAt(placePositionVec3);
            if (!placeblock?.name.includes("air") && !placeblock?.name.includes("void") && !placeblock?.name.includes("water")) {
                return { "success": false, "result": `${placePositionVec3}に設置可能な空間がありません。get-blocks-dataツールで確認してください。` };
            }
            const placedBlock = this.bot.blockAt(placedBlockPositionVec3);
            if (placedBlock?.name.includes("air") || placedBlock?.name.includes("void") || placedBlock?.name.includes("water")) {
                return { "success": false, "result": `${placedBlockPositionVec3}に設置可能なブロックがありません。get-blocks-dataツールで確認してください。` };
            }
            const response = await this.holdItem.run(blockName, false);
            if (!response.success) {
                return response;
            }
            const relativePosition = placePositionVec3.minus(placedBlockPositionVec3);
            if (!((Math.abs(relativePosition.x) === 1 && relativePosition.y === 0 && relativePosition.z === 0) ||
                  (relativePosition.x === 0 && Math.abs(relativePosition.y) === 1 && relativePosition.z === 0) ||
                  (relativePosition.x === 0 && relativePosition.y === 0 && Math.abs(relativePosition.z) === 1))) {
                return { "success": false, "result": "ブロックを置く座標と既に置いてあるブロックの座標の差は単位ベクトルでなければなりません。" };
            }

            // ブロック設置のために近づく
            try {
                // 設置位置に近づく（ブロック設置の最適距離は約2〜3ブロック）
                await this.bot.pathfinder.goto(new goals.GoalNear(placedBlockPositionVec3.x, placedBlockPositionVec3.y, placedBlockPositionVec3.z, 2));
            } catch (moveError: any) {
                console.error('移動に失敗しました:', moveError);
                return { "success": false, "result": `ブロックを設置する場所まで移動できませんでした: ${moveError.message}` };
            }

            // ブロックまでの距離を確認
            const botPosition = this.bot.entity.position;
            const distanceToBlock = botPosition.distanceTo(placedBlockPositionVec3);
            if (distanceToBlock > 4) {
                return { "success": false, "result": `ブロックを設置する場所が遠すぎます（距離: ${distanceToBlock.toFixed(2)}ブロック）。より近くに移動してください。` };
            }

            try {
                // タイムアウト対策としてプロミスに10秒の制限を設ける
                const placePromise = this.bot.placeBlock(placedBlock as Block, relativePosition);
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('ブロック設置がタイムアウトしました')), 10000)
                );
                
                await Promise.race([placePromise, timeoutPromise]);
                return { "success": true, "result": `${blockName}を${placePositionVec3}に置きました。` };
            } catch (placeError: any) {
                console.error('ブロック設置に失敗しました:', placeError);
                
                // より詳細なエラーメッセージを提供
                if (placeError.message.includes('timeout')) {
                    return { "success": false, "result": `ブロック設置がタイムアウトしました。ブロックが到達可能な範囲内にあるか確認してください。` };
                } else {
                    return { "success": false, "result": `ブロック設置に失敗しました: ${placeError.message}` };
                }
            }
        } catch (error: any) {
            return { "success": false, "result": `${error.message} in ${error.stack}` };
        }
    }

    // 文字列やオブジェクトからVec3オブジェクトに変換する関数
    private parseVec3(input: any): Vec3 | null {
        try {
            // すでにVec3オブジェクトの場合
            if (input instanceof Vec3) {
                return input;
            }
            
            // 文字列の場合（例: "0,0,0"）
            if (typeof input === 'string') {
                const coords = input.split(',').map(v => parseFloat(v.trim()));
                if (coords.length === 3 && !isNaN(coords[0]) && !isNaN(coords[1]) && !isNaN(coords[2])) {
                    return new Vec3(coords[0], coords[1], coords[2]);
                }
            }
            
            // オブジェクトの場合（例: {x: 0, y: 0, z: 0}）
            if (typeof input === 'object' && input !== null && 'x' in input && 'y' in input && 'z' in input) {
                const x = parseFloat(input.x);
                const y = parseFloat(input.y);
                const z = parseFloat(input.z);
                if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
                    return new Vec3(x, y, z);
                }
            }
            
            return null;
        } catch (error) {
            console.error('Vec3のパースに失敗しました:', error);
            return null;
        }
    }
}

export default PlaceBlock;
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';

/**
 * 階段掘り/埋めスキル
 * 目標の高さまで階段状に移動する（掘る or ブロックを置く）
 */
class StairMine extends InstantSkill {
    private mcData: any;

    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'stair-mine';
        this.description = '階段を掘りながら（または置きながら）目標の高さまで移動します。';
        this.mcData = minecraftData(this.bot.version);
        this.params = [
            {
                name: 'targetY',
                type: 'number',
                description: '目標のY座標（高さ）',
                required: true,
            },
            {
                name: 'direction',
                type: 'string',
                description: '進む方向: "north", "south", "east", "west"。省略時は現在向いている方向',
                default: '',
            },
            {
                name: 'placeBlock',
                type: 'string',
                description: '上昇時に置くブロック名（省略時はcobblestone）',
                default: 'cobblestone',
            },
        ];
    }

    async runImpl(targetY: number, direction: string = '', placeBlock: string = 'cobblestone') {
        try {
            const currentY = Math.floor(this.bot.entity.position.y);
            const diff = targetY - currentY;

            if (Math.abs(diff) < 1) {
                return {
                    success: true,
                    result: `すでに目標の高さ（Y=${targetY}）にいます`,
                };
            }

            // 方向を決定
            let dir: Vec3;
            if (direction) {
                const directions: { [key: string]: Vec3 } = {
                    'north': new Vec3(0, 0, -1),
                    'south': new Vec3(0, 0, 1),
                    'east': new Vec3(1, 0, 0),
                    'west': new Vec3(-1, 0, 0),
                };
                dir = directions[direction.toLowerCase()];
                if (!dir) {
                    return {
                        success: false,
                        result: `無効な方向: ${direction}。north, south, east, west のいずれかを指定してください`,
                    };
                }
            } else {
                // 現在向いている方向を使用
                const yaw = this.bot.entity.yaw;
                // yawを4方向に変換
                const normalized = ((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
                if (normalized >= 0.25 * Math.PI && normalized < 0.75 * Math.PI) {
                    dir = new Vec3(-1, 0, 0); // west
                } else if (normalized >= 0.75 * Math.PI && normalized < 1.25 * Math.PI) {
                    dir = new Vec3(0, 0, 1); // south (逆かも)
                } else if (normalized >= 1.25 * Math.PI && normalized < 1.75 * Math.PI) {
                    dir = new Vec3(1, 0, 0); // east
                } else {
                    dir = new Vec3(0, 0, -1); // north
                }
            }

            const isDescending = diff < 0;
            const steps = Math.abs(diff);
            let successSteps = 0;

            // タイムアウト設定（60秒）
            const TIMEOUT_MS = 60 * 1000;
            const startTime = Date.now();

            console.log(`\x1b[36m⛏️ 階段${isDescending ? '下降' : '上昇'}開始: Y=${currentY} → Y=${targetY} (${steps}段, 最大60秒)\x1b[0m`);

            for (let i = 0; i < steps; i++) {
                // 中断チェック
                if (this.shouldInterrupt()) {
                    return {
                        success: successSteps > 0,
                        result: `中断: ${successSteps}段${isDescending ? '下降' : '上昇'}しました（Y=${Math.floor(this.bot.entity.position.y)}）`,
                    };
                }

                // タイムアウトチェック
                if (Date.now() - startTime > TIMEOUT_MS) {
                    const elapsed = Math.round((Date.now() - startTime) / 1000);
                    return {
                        success: successSteps > 0,
                        result: `タイムアウト（${elapsed}秒）: ${successSteps}段${isDescending ? '下降' : '上昇'}しました（Y=${Math.floor(this.bot.entity.position.y)}）`,
                    };
                }

                const currentPos = this.bot.entity.position.floored();

                if (isDescending) {
                    // 下降: 前方に1ブロック進んで1ブロック下を掘る
                    const success = await this.digStairDown(currentPos, dir);
                    if (!success) {
                        return {
                            success: successSteps > 0,
                            result: `${successSteps}段下降しました（Y=${Math.floor(this.bot.entity.position.y)}）。これ以上掘れません`,
                        };
                    }
                } else {
                    // 上昇: ブロックを置いて登る
                    const success = await this.buildStairUp(currentPos, dir, placeBlock);
                    if (!success) {
                        return {
                            success: successSteps > 0,
                            result: `${successSteps}段上昇しました（Y=${Math.floor(this.bot.entity.position.y)}）。これ以上登れません`,
                        };
                    }
                }

                successSteps++;

                // 進捗表示
                if (successSteps % 5 === 0) {
                    console.log(`\x1b[36m⛏️ ${successSteps}/${steps}段完了\x1b[0m`);
                }

                // 少し待機
                await this.sleep(100);
            }

            return {
                success: true,
                result: `${successSteps}段${isDescending ? '下降' : '上昇'}してY=${Math.floor(this.bot.entity.position.y)}に到達しました`,
            };
        } catch (error: any) {
            return {
                success: false,
                result: `階段掘りエラー: ${error.message}`,
            };
        }
    }

    /**
     * 下降用: 階段を掘って降りる
     */
    private async digStairDown(currentPos: Vec3, dir: Vec3): Promise<boolean> {
        try {
            // 次の位置（前方1ブロック、下1ブロック）
            const nextPos = currentPos.offset(dir.x, -1, dir.z);

            // 頭の高さ（前方、現在の高さ）のブロックを確認・掘削
            const headBlock = this.bot.blockAt(currentPos.offset(dir.x, 1, dir.z));
            if (headBlock && headBlock.name !== 'air' && headBlock.name !== 'cave_air') {
                if (!headBlock.diggable) {
                    console.log(`\x1b[33m⚠ ${headBlock.name}は掘れません\x1b[0m`);
                    return false;
                }
                await this.digBlockSafe(headBlock);
            }

            // 足の高さ（前方、現在の高さ）のブロックを確認・掘削
            const bodyBlock = this.bot.blockAt(currentPos.offset(dir.x, 0, dir.z));
            if (bodyBlock && bodyBlock.name !== 'air' && bodyBlock.name !== 'cave_air') {
                if (!bodyBlock.diggable) {
                    console.log(`\x1b[33m⚠ ${bodyBlock.name}は掘れません\x1b[0m`);
                    return false;
                }
                await this.digBlockSafe(bodyBlock);
            }

            // 足元（前方、下1ブロック）のブロックを確認・掘削
            const floorBlock = this.bot.blockAt(nextPos);
            if (floorBlock && floorBlock.name !== 'air' && floorBlock.name !== 'cave_air') {
                if (!floorBlock.diggable) {
                    console.log(`\x1b[33m⚠ ${floorBlock.name}は掘れません\x1b[0m`);
                    return false;
                }
                await this.digBlockSafe(floorBlock);
            }

            // 移動（前方に1ブロック進む → 自然に落ちる）
            const moveTarget = currentPos.offset(dir.x, 0, dir.z);
            this.bot.setControlState('forward', true);
            await this.sleep(300);
            this.bot.setControlState('forward', false);

            // 落下を待つ
            await this.sleep(200);

            return true;
        } catch (error: any) {
            console.error(`下降エラー: ${error.message}`);
            return false;
        }
    }

    /**
     * 上昇用: 階段を置いて登る
     */
    private async buildStairUp(currentPos: Vec3, dir: Vec3, blockName: string): Promise<boolean> {
        try {
            // 置くブロックがあるか確認
            const item = this.bot.inventory.items().find(i => i.name === blockName);
            if (!item) {
                // 代替ブロックを探す
                const alternatives = ['cobblestone', 'stone', 'dirt', 'netherrack', 'cobbled_deepslate'];
                let found = false;
                for (const alt of alternatives) {
                    const altItem = this.bot.inventory.items().find(i => i.name === alt);
                    if (altItem) {
                        blockName = alt;
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    console.log(`\x1b[33m⚠ 置けるブロックがありません\x1b[0m`);
                    return false;
                }
            }

            // 頭上のブロック（頭上+1）を確認・掘削
            const aboveHead = this.bot.blockAt(currentPos.offset(0, 2, 0));
            if (aboveHead && aboveHead.name !== 'air' && aboveHead.name !== 'cave_air') {
                if (aboveHead.diggable) {
                    await this.digBlockSafe(aboveHead);
                }
            }

            // 前方の上のブロック（頭上+1）を確認・掘削
            const aboveNextHead = this.bot.blockAt(currentPos.offset(dir.x, 2, dir.z));
            if (aboveNextHead && aboveNextHead.name !== 'air' && aboveNextHead.name !== 'cave_air') {
                if (aboveNextHead.diggable) {
                    await this.digBlockSafe(aboveNextHead);
                }
            }

            // 前方の頭の高さのブロックを確認・掘削
            const nextHead = this.bot.blockAt(currentPos.offset(dir.x, 1, dir.z));
            if (nextHead && nextHead.name !== 'air' && nextHead.name !== 'cave_air') {
                if (nextHead.diggable) {
                    await this.digBlockSafe(nextHead);
                }
            }

            // 前方の足元のブロックを確認
            const nextFoot = this.bot.blockAt(currentPos.offset(dir.x, 0, dir.z));

            if (!nextFoot || nextFoot.name === 'air' || nextFoot.name === 'cave_air') {
                // 空気なら階段ブロックを置く
                const placePos = currentPos.offset(dir.x, 0, dir.z);
                const placed = await this.placeBlockSafe(blockName, placePos);
                if (!placed) {
                    console.log(`\x1b[33m⚠ ブロックを置けませんでした\x1b[0m`);
                    return false;
                }
            }

            // ジャンプして前方に移動
            this.bot.setControlState('jump', true);
            this.bot.setControlState('forward', true);
            await this.sleep(400);
            this.bot.setControlState('jump', false);
            this.bot.setControlState('forward', false);

            // 着地を待つ
            await this.sleep(200);

            return true;
        } catch (error: any) {
            console.error(`上昇エラー: ${error.message}`);
            return false;
        }
    }

    /**
     * ブロックを安全に掘る
     */
    private async digBlockSafe(block: any): Promise<boolean> {
        try {
            if (!block || !block.diggable) return false;

            // 最適なツールを装備
            const tool = this.findBestTool(block);
            if (tool) {
                await this.bot.equip(tool, 'hand');
            }

            await this.bot.dig(block);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * ブロックを安全に置く
     */
    private async placeBlockSafe(blockName: string, pos: Vec3): Promise<boolean> {
        try {
            const item = this.bot.inventory.items().find(i => i.name === blockName);
            if (!item) return false;

            // 参照ブロックを探す
            const offsets: [number, number, number, Vec3][] = [
                [0, -1, 0, new Vec3(0, 1, 0)],
                [1, 0, 0, new Vec3(-1, 0, 0)],
                [-1, 0, 0, new Vec3(1, 0, 0)],
                [0, 0, 1, new Vec3(0, 0, -1)],
                [0, 0, -1, new Vec3(0, 0, 1)],
                [0, 1, 0, new Vec3(0, -1, 0)],
            ];

            let referenceBlock = null;
            let faceVector = new Vec3(0, 1, 0);

            for (const [ox, oy, oz, face] of offsets) {
                const candidate = this.bot.blockAt(pos.offset(ox, oy, oz));
                if (candidate && candidate.name !== 'air' && candidate.name !== 'cave_air') {
                    referenceBlock = candidate;
                    faceVector = face;
                    break;
                }
            }

            if (!referenceBlock) return false;

            await this.bot.equip(item, 'hand');
            await this.bot.placeBlock(referenceBlock, faceVector);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * ブロックに最適なツールを探す
     */
    private findBestTool(block: any): any {
        const items = this.bot.inventory.items();
        const blockName = block.name.toLowerCase();

        let toolType: string[] = [];

        if (blockName.includes('stone') || blockName.includes('ore') || blockName.includes('cobble') ||
            blockName.includes('deepslate') || blockName.includes('brick')) {
            toolType = ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe'];
        } else if (blockName.includes('dirt') || blockName.includes('sand') || blockName.includes('gravel')) {
            toolType = ['netherite_shovel', 'diamond_shovel', 'iron_shovel', 'stone_shovel', 'wooden_shovel'];
        } else if (blockName.includes('log') || blockName.includes('wood') || blockName.includes('plank')) {
            toolType = ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'];
        }

        for (const name of toolType) {
            const tool = items.find(i => i.name === name);
            if (tool) return tool;
        }

        return null;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export default StairMine;


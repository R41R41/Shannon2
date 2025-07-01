import pathfinder from 'mineflayer-pathfinder';
import { CustomBot, InstantSkill } from '../types.js';
const { goals } = pathfinder;

class ChangeDimension extends InstantSkill {
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'change-dimension';
        this.description =
            '指定されたディメンションに移動します。';
        this.status = false;
        this.params = [
            {
                name: 'dimension',
                description:
                    'ディメンション。例: overworld, the_nether, the_end',
                type: 'string',
            },
        ];
    }

    async runImpl(dimension: string): Promise<{ success: boolean, result: string }> {
        const botDimension = this.bot.game.dimension;
        if (botDimension === dimension) {
            return {
                success: false,
                result: `すでに${dimension}にいます`,
            };
        }
        if (botDimension !== 'overworld' && dimension !== 'overworld') {
            return {
                success: false,
                result: `ネザーとエンド間の移動には対応していません`,
            };
        }
        if (botDimension === 'the_nether') {
            const result = await this.searchNetherGateAndGoto();
            if (!result.success) {
                return result;
            }
        } else if (botDimension === 'the_end') {
            const result = await this.searchEndPortalAndGoto();
            if (!result.success) {
                return result;
            }
        } else {
            if (dimension === 'the_nether') {
                const result = await this.searchNetherGateAndGoto();
                if (!result.success) {
                    return result;
                }
            } else if (dimension === 'the_end') {
                const result = await this.searchEndPortalAndGoto();
                if (!result.success) {
                    return result;
                }
            }
        }
        return {
            success: true,
            result: `${dimension}に移動しました`,
        };
    }

    async searchNetherGateAndGoto(): Promise<{ success: boolean, result: string }> {
        try {
            // ネザーポータルを探す
            let portal = this.bot.findBlock({
                matching: (block) => block.name === 'nether_portal',
                maxDistance: 64
            });

            if (!portal) {
                return {
                    success: false,
                    result: '周囲64ブロック以内にネザーポータルが見つかりません'
                };
            }

            let targetPortal = null;
            while (targetPortal === null && portal) {
                if (this.bot.blockAt(portal.position.offset(0, -1, 0))?.name === 'obsidian') {
                    targetPortal = portal
                }
                portal = this.bot.blockAt(portal.position.offset(0, -1, 0))
            }

            if (!targetPortal) {
                return {
                    success: false,
                    result: '周囲64ブロック以内に有効なネザーポータル（下が黒曜石）が見つかりません'
                };
            }

            console.log(`有効なネザーポータルを発見: ${JSON.stringify(targetPortal.position)}`);

            const goal = new goals.GoalNear(
                targetPortal.position.x,
                targetPortal.position.y,
                targetPortal.position.z,
                0.5
            );

            try {
                await this.bot.pathfinder.goto(goal);
                // botがネザーポータルに到達したかどうかを確認
                if (this.bot.blockAt(targetPortal.position.offset(0, -1, 0))?.name !== 'obsidian') {
                    return {
                        success: false,
                        result: 'ネザーポータルの中に到達していません'
                    };
                }
                console.log('ネザーポータルに到達しました');
                await new Promise(resolve => setTimeout(resolve, 10 * 1000)); // 10秒待つ
                if (this.bot.game.dimension !== 'the_nether') {
                    return {
                        success: false,
                        result: 'ネザーポータルに到達しましたが、ネザーに移動できませんでした'
                    };
                }
                return {
                    success: true,
                    result: 'ネザーに到達しました'
                };
            } catch (error: any) {
                return {
                    success: false,
                    result: `ネザーポータルへの移動に失敗しました: ${error.message}`
                };
            }
        } catch (error: any) {
            return {
                success: false,
                result: `ネザーポータル探索中にエラーが発生しました: ${error.message}`
            };
        }
    }

    async searchEndPortalAndGoto(): Promise<{ success: boolean, result: string }> {
        try {
            // エンドポータルを探す
            const portalFrame = this.bot.findBlock({
                matching: (block) => block.name === 'end_portal_frame',
                maxDistance: 64
            });

            if (!portalFrame) {
                return {
                    success: false,
                    result: '周囲64ブロック以内にエンドポータルフレームが見つかりません'
                };
            }

            console.log(`エンドポータルフレームを発見: ${JSON.stringify(portalFrame.position)}`);

            const goal = new goals.GoalNear(
                portalFrame.position.x,
                portalFrame.position.y + 1,
                portalFrame.position.z,
                0.5
            );

            try {
                await this.bot.pathfinder.goto(goal);
                console.log('エンドポータルフレームに到達しました');
                let portal = this.bot.findBlock({
                    matching: (block) => block.name === 'end_portal',
                    maxDistance: 8
                });
                if (!portal) {
                    return {
                        success: false,
                        result: 'エンドポータルが見つかりません'
                    };
                }
                // 3x3の中心のポータルを探す
                // まずは一番x座標が大きいものを探す
                let maxXPortal = null;
                while (maxXPortal === null && portal) {
                    if (this.bot.blockAt(portal.position.offset(1, 0, 0))?.name === 'end_portal_frame') {
                        maxXPortal = portal
                    }
                    portal = this.bot.blockAt(portal.position.offset(1, 0, 0))
                }
                if (!maxXPortal) {
                    return {
                        success: false,
                        result: 'x座標が最大のエンドポータルが見つかりません'
                    };
                }
                // 次に一番z座標が大きいものを探す
                let maxZPortal = null;
                while (maxZPortal === null && portal) {
                    if (this.bot.blockAt(maxXPortal.position.offset(0, 0, 1))?.name === 'end_portal_frame') {
                        maxZPortal = portal
                    }
                    portal = this.bot.blockAt(maxXPortal.position.offset(0, 0, 1))
                }
                if (!maxZPortal) {
                    return {
                        success: false,
                        result: '角のエンドポータルが見つかりません'
                    };
                }
                const targetPortal = this.bot.blockAt(maxZPortal.position.offset(-1, 0, -1))
                if (!targetPortal) {
                    return {
                        success: false,
                        result: '真ん中のエンドポータルが見つかりません'
                    };
                }
                this.bot.lookAt(targetPortal.position);
                await new Promise(resolve => setTimeout(resolve, 1 * 1000)); // 1秒待つ
                // ポータルにジャンプする
                this.bot.setControlState('forward', true)
                this.bot.setControlState('sprint', true)
                this.bot.setControlState('jump', true)
                await new Promise(resolve => setTimeout(resolve, 0.1 * 1000)); // 0.1秒待つ
                this.bot.setControlState('forward', false)
                this.bot.setControlState('sprint', false)
                this.bot.setControlState('jump', false)
                await new Promise(resolve => setTimeout(resolve, 1 * 1000)); // 1秒待つ
                if (this.bot.game.dimension !== 'the_end') {
                    return {
                        success: false,
                        result: 'エンドポータルに到達しましたが、エンドに移動できませんでした'
                    };
                }
                return {
                    success: true,
                    result: 'エンドに到達しました'
                };
            } catch (error: any) {
                return {
                    success: false,
                    result: `エンドポータルへの移動に失敗しました: ${error.message}`
                };
            }
        } catch (error: any) {
            return {
                success: false,
                result: `エンドポータル探索中にエラーが発生しました: ${error.message}`
            };
        }
    }
}

export default ChangeDimension;

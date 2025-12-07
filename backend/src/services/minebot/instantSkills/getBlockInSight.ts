import { CustomBot, InstantSkill } from '../types.js';

/**
 * ボットが見ている方向のブロック座標を取得するスキル
 * describe-bot-viewで特定したものの座標を知りたい時に使用
 */
class GetBlockInSight extends InstantSkill {
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'get-block-in-sight';
        this.description =
            'ボットが現在見ている方向にあるブロックの座標を取得します。describe-bot-viewで見つけたものの正確な座標を知りたい時に使用します。';
        this.params = [
            {
                name: 'maxDistance',
                type: 'number',
                description: '検索する最大距離（デフォルト: 64ブロック）',
                default: 64,
            },
        ];
    }

    async runImpl(maxDistance: number = 64) {
        try {
            // ボットが見ている方向のブロックを取得
            const block = this.bot.blockAtCursor(maxDistance);

            if (!block) {
                return {
                    success: true,
                    result: `${maxDistance}ブロック以内に見ているブロックはありません（空を見ている可能性があります）`,
                };
            }

            // ブロックの上面座標（登る場合はここに移動する）
            const topX = block.position.x;
            const topY = block.position.y + 1; // ブロックの上
            const topZ = block.position.z;

            return {
                success: true,
                result: `見ているブロック: ${block.name} at (${block.position.x}, ${block.position.y}, ${block.position.z})\n\n【このブロックの上に移動するには】\nmove-to: {"x":${topX},"y":${topY},"z":${topZ}}\n\n※屋根など高い場所の場合は、まず近くまで移動してから登る経路を探す必要があるかもしれません。`,
            };
        } catch (error: any) {
            return {
                success: false,
                result: `エラー: ${error.message}`,
            };
        }
    }
}

export default GetBlockInSight;


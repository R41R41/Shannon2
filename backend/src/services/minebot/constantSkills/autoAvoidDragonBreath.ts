import { ConstantSkill, CustomBot } from '../types.js';

class AutoAvoidDragonBreath extends ConstantSkill {
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'auto-avoid-dragon-breath';
        this.description = 'エンドラのブレスを検知して避けます';
        this.interval = 1000; // より頻繁にチェック
        this.isLocked = false;
        this.priority = 12; // 高い優先度で実行
        this.status = true;
        this.containMovement = true;
    }

    async runImpl() {
        try {
            // エンドラのブレスエフェクトを検索
            const dragonBreath = this.bot.nearestEntity((entity) =>
                entity.name === 'area_effect_cloud' &&
                entity.position.distanceTo(this.bot.entity.position) <= 8 && (entity.metadata[10] as any).type === "dragon_breath"
            );

            if (!dragonBreath) {
                return;
            }

            // ブレスの位置を取得
            const breathPos = dragonBreath.position;
            const botPos = this.bot.entity.position;

            // ブレスからの距離を計算
            const distance = botPos.distanceTo(breathPos);

            // ブレスが近すぎる場合（8ブロック以内）
            if (distance < 8) {
                await this.bot.utils.runFromEntities(this.bot, [dragonBreath], 12);
            }
        } catch (error: any) {
            console.error(`エンドラのブレス回避中にエラー: ${error.message}`);
        }
    }
}

export default AutoAvoidDragonBreath;
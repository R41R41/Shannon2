import { Vec3 } from 'vec3';
import { ConstantSkill, CustomBot } from '../types.js';

/**
 * AutoFaceSpeaker
 * 話しかけてきたプレイヤーの方を向く常時スキル
 */
class AutoFaceSpeaker extends ConstantSkill {
    private lastSpeaker: string | null = null;
    private lastSpeakTime: number = 0;
    private speakCooldown: number = 2000; // 2秒のクールダウン

    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'auto-face-speaker';
        this.description = '話しかけてきたプレイヤーの方を向きます';
        this.status = true; // デフォルトで有効
        this.isLocked = false;
        this.interval = null; // イベント駆動型なのでintervalは不要
        this.priority = 3; // 他の視線スキルより優先
    }

    /**
     * プレイヤーが話しかけてきたときに呼び出される
     */
    async onPlayerSpeak(playerName: string): Promise<void> {
        if (!this.status) return;
        if (this.isLocked) return;

        const now = Date.now();

        // 同じプレイヤーからの連続発言はクールダウン
        if (this.lastSpeaker === playerName && now - this.lastSpeakTime < this.speakCooldown) {
            return;
        }

        this.lastSpeaker = playerName;
        this.lastSpeakTime = now;

        // スキルの実行を要求
        await this.bot.constantSkills.requestExecution(this, [playerName]);
    }

    async runImpl(playerName?: string): Promise<void> {
        if (!playerName) return;

        // プレイヤーのエンティティを探す
        const playerEntity = Object.values(this.bot.entities).find(
            (e) => e.type === 'player' && e.username === playerName
        );

        if (!playerEntity) {
            console.log(`⚠️ プレイヤー ${playerName} が見つかりません`);
            return;
        }

        // 距離をチェック（10ブロック以内）
        const distance = this.bot.entity.position.distanceTo(playerEntity.position);
        if (distance > 10) {
            console.log(`⚠️ プレイヤー ${playerName} が遠すぎます (${distance.toFixed(1)}ブロック)`);
            return;
        }

        // プレイヤーの頭の位置を計算
        const headPos = new Vec3(
            playerEntity.position.x,
            playerEntity.position.y + (playerEntity.height || 1.62),
            playerEntity.position.z
        );

        // そちらを向く
        await this.bot.lookAt(headPos);

        console.log(`👀 ${playerName}の方を向きました`);

        // 少し待つ（ロックは親クラスのrun()が管理）
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
}

export default AutoFaceSpeaker;


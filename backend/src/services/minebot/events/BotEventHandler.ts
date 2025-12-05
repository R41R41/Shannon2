import { BaseMessage } from '@langchain/core/messages';
import { EventReactionSystem } from '../eventReaction/EventReactionSystem.js';
import { CentralAgent } from '../llm/graph/centralAgent.js';
import { CustomBot } from '../types.js';

/**
 * BotEventHandler
 * Minecraftボットのイベント処理を担当
 */
export class BotEventHandler {
    private bot: CustomBot;
    private centralAgent: CentralAgent;
    private recentMessages: BaseMessage[];
    private lastHealth: number = 20;
    private lastOxygen: number = 300;
    private consecutiveDamageCount: number = 0;
    private lastDamageTime: number = 0;
    private eventReactionSystem: EventReactionSystem | null = null;

    constructor(bot: CustomBot, centralAgent: CentralAgent, recentMessages: BaseMessage[]) {
        this.bot = bot;
        this.centralAgent = centralAgent;
        this.recentMessages = recentMessages;
        this.lastHealth = bot.health || 20;
    }

    /**
     * EventReactionSystemを設定
     */
    public setEventReactionSystem(system: EventReactionSystem): void {
        this.eventReactionSystem = system;
    }

    /**
     * 全てのイベントハンドラを登録
     */
    registerAll(): void {
        this.registerEntitySpawn();
        this.registerEntityHurt();
        this.registerHealth();
        this.registerBlockUpdate();
        this.registerEntityMove();
        this.registerBossbar();
        console.log('✅ All bot event handlers registered');
    }

    /**
     * entitySpawnイベント - アイテム自動収集
     */
    private registerEntitySpawn(): void {
        this.bot.on('entitySpawn', async (entity) => {
            const autoPickUpItem = this.bot.constantSkills.getSkill('auto-pick-up-item');
            if (!autoPickUpItem) {
                return;
            }
            if (!autoPickUpItem.status) return;

            try {
                await autoPickUpItem.run(entity);
            } catch (error) {
                console.error('エラーが発生しました:', error);
            }
        });
    }

    /**
     * entityHurtイベント - ダメージ通知
     */
    private registerEntityHurt(): void {
        this.bot.on('entityHurt', async (entity) => {
            if (entity === this.bot.entity) {
                this.bot.chat(`ダメージを受けました: ${this.bot.health.toFixed(1)}/20`);
            }
        });
    }

    /**
     * healthイベント - 自動食事 & 緊急反応
     */
    private registerHealth(): void {
        this.bot.on('health', async () => {
            const currentHealth = this.bot.health || 0;
            const currentTime = Date.now();

            // ダメージ検知
            if (currentHealth < this.lastHealth) {
                const damage = this.lastHealth - currentHealth;
                const damagePercent = (damage / 20) * 100;

                // ダメージを検知したらEventReactionSystemに通知
                if (this.eventReactionSystem) {
                    // 大きなダメージ（20%以上）または連続ダメージを検知
                    if (damagePercent >= 20 || (currentTime - this.lastDamageTime < 3000)) {
                        this.consecutiveDamageCount++;
                    } else {
                        this.consecutiveDamageCount = 0;
                    }

                    console.log(`\x1b[33m⚠️ ダメージ検知 (-${damage.toFixed(1)} HP, ${damagePercent.toFixed(1)}%) 連続: ${this.consecutiveDamageCount}\x1b[0m`);

                    await this.eventReactionSystem.handleDamage({
                        damage,
                        damagePercent,
                        currentHealth,
                        consecutiveCount: this.consecutiveDamageCount,
                    });
                }

                this.lastDamageTime = currentTime;
            } else if (currentHealth > this.lastHealth) {
                // 回復したら連続カウントをリセット
                this.consecutiveDamageCount = 0;
            }

            // 窒息検知（水中または埋まっている状態でHPが減っている）
            const entity = this.bot.entity as any;
            if (entity?.isInWater || entity?.isCollidedVertically) {
                const oxygen = (this.bot as any).oxygen || 300;
                if (oxygen < this.lastOxygen - 30 || (oxygen < 100 && currentHealth < this.lastHealth)) {
                    console.log(`\x1b[31m⚠️ 緊急: 窒息検知 (酸素: ${oxygen}/300, HP: ${currentHealth}/20)\x1b[0m`);

                    if (this.eventReactionSystem) {
                        await this.eventReactionSystem.handleSuffocation({
                            oxygen,
                            health: currentHealth,
                            isInWater: entity?.isInWater || false,
                        });
                    }
                }
                this.lastOxygen = oxygen;
            }

            this.lastHealth = currentHealth;

            // 自動食事（既存機能）
            const autoEat = this.bot.constantSkills.getSkill('auto-eat');
            if (!autoEat) {
                return;
            }
            if (!autoEat.status) return;

            try {
                await autoEat.run();
            } catch (error) {
                console.error('エラーが発生しました:', error);
            }
        });
    }

    /**
     * blockUpdateイベント - ブロック更新時の自動視線移動
     */
    private registerBlockUpdate(): void {
        this.bot.on('blockUpdate', async (block) => {
            if (!block) return;

            const distance = this.bot.entity.position.distanceTo(block.position);
            if (distance > 4) return;

            const autoFaceUpdatedBlock = this.bot.constantSkills.getSkill(
                'auto-face-updated-block'
            );
            if (!autoFaceUpdatedBlock) {
                return;
            }
            if (!autoFaceUpdatedBlock.status) return;
            if (autoFaceUpdatedBlock.isLocked) return;

            try {
                await autoFaceUpdatedBlock.run(block);
            } catch (error) {
                console.error('エラーが発生しました:', error);
            }
        });
    }

    /**
     * entityMoveイベント - エンティティ移動時の自動視線移動
     */
    private registerEntityMove(): void {
        this.bot.on('entityMoved', async (entity) => {
            const distance = this.bot.entity.position.distanceTo(entity.position);
            if (distance > 4) return;

            const autoFaceMovedEntity = this.bot.constantSkills.getSkill(
                'auto-face-moved-entity'
            );
            if (!autoFaceMovedEntity) {
                return;
            }
            if (!autoFaceMovedEntity.status) return;
            if (autoFaceMovedEntity.isLocked) return;

            try {
                await autoFaceMovedEntity.run(entity);
            } catch (error) {
                console.error('エラーが発生しました:', error);
            }
        });
    }

    /**
     * bossbarイベント - ボスバー情報の管理
     */
    private registerBossbar(): void {
        this.bot.on('bossBarCreated', async (bossbar) => {
            this.bot.environmentState.bossbar = JSON.stringify({
                title: bossbar.title.translate,
                health: Math.round(bossbar.health * 100),
                color: bossbar.color,
                isDragonBar: Number(bossbar.isDragonBar) === 2,
            });
        });

        this.bot.on('bossBarUpdated', async (bossbar) => {
            const bossbarInfo = {
                title: bossbar.title.translate,
                health: Math.round(bossbar.health * 100),
                color: bossbar.color,
                isDragonBar: Number(bossbar.isDragonBar) === 2,
            };
            this.bot.environmentState.bossbar = JSON.stringify(bossbarInfo);
        });

        this.bot.on('bossBarDeleted', async (bossbar) => {
            this.bot.environmentState.bossbar = null;
        });
    }
}


/**
 * EmergencyResponder
 * 緊急事態に即座に対応するシステム
 * 軽量モデルを使用して高速に判断・実行
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { createTracedModel } from '../../llm/utils/langfuse.js';
import { CustomBot } from '../types.js';
import { models } from '../../../config/models.js';
import {
    DamageEventData,
    EventData,
    HostileEventData,
    SuffocationEventData,
} from './types.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('Minebot:Emergency');

interface EmergencyAction {
    type: 'flee' | 'eat' | 'equip' | 'attack' | 'dig_up' | 'swim_up' | 'none';
    target?: string;
    direction?: { x: number; y: number; z: number };
}

export class EmergencyResponder {
    private bot: CustomBot;
    private llm: ChatOpenAI;
    private isResponding: boolean = false;

    constructor(bot: CustomBot) {
        this.bot = bot;
        this.llm = createTracedModel({
            modelName: models.emergency,
            temperature: 0.1,
            maxTokens: 150,
        });
    }

    /**
     * 初期化
     */
    async initialize(): Promise<void> {
        log.success('✅ EmergencyResponder initialized');
    }

    /**
     * 緊急事態に対応
     */
    async respond(eventData: EventData): Promise<string> {
        if (this.isResponding) {
            log.warn('⚠️ 緊急対応中のため新しい緊急対応をスキップ');
            return 'already_responding';
        }

        this.isResponding = true;

        try {
            // イベントタイプに応じて即時アクションを実行
            const action = await this.decideAction(eventData);
            await this.executeAction(action);
            return action.type;
        } catch (error) {
            log.error('緊急対応エラー', error);
            return 'error';
        } finally {
            this.isResponding = false;
        }
    }

    /**
     * アクションを決定
     */
    private async decideAction(eventData: EventData): Promise<EmergencyAction> {
        // まずルールベースで即時判断
        const ruleBasedAction = this.getRuleBasedAction(eventData);
        if (ruleBasedAction.type !== 'none') {
            return ruleBasedAction;
        }

        // ルールベースで判断できない場合はLLMに聞く
        return this.getLLMAction(eventData);
    }

    /**
     * ルールベースでアクションを決定
     */
    private getRuleBasedAction(eventData: EventData): EmergencyAction {
        switch (eventData.eventType) {
            case 'suffocation':
                const suff = eventData as SuffocationEventData;
                if (suff.isInWater) {
                    return { type: 'swim_up' };
                } else {
                    return { type: 'dig_up' };
                }

            case 'damage':
                const dmg = eventData as DamageEventData;

                // HP が低い場合、まず食べ物を食べる
                if (dmg.currentHealth < 10 && this.hasFood()) {
                    return { type: 'eat' };
                }

                // 連続ダメージの場合は逃げる
                if (dmg.consecutiveCount >= 2) {
                    const fleeDirection = this.calculateFleeDirection();
                    return { type: 'flee', direction: fleeDirection };
                }

                // 攻撃元がわかる場合
                if (dmg.possibleSource) {
                    // 武器を装備して反撃
                    if (this.hasWeapon()) {
                        return { type: 'equip', target: 'weapon' };
                    }
                }

                return { type: 'none' };

            case 'hostile_approach':
                const hostile = eventData as HostileEventData;

                // 複数の敵がいる場合は逃げる
                if (hostile.mobCount >= 3) {
                    const fleeDirection = this.calculateFleeDirection(hostile.mobPosition);
                    return { type: 'flee', direction: fleeDirection };
                }

                // 武器があれば装備
                if (this.hasWeapon()) {
                    return { type: 'equip', target: 'weapon' };
                }

                return { type: 'none' };

            default:
                return { type: 'none' };
        }
    }

    /**
     * LLMでアクションを決定
     */
    private async getLLMAction(eventData: EventData): Promise<EmergencyAction> {
        const systemPrompt = `あなたはMinecraftボットの緊急対応AIです。
緊急事態に対して最も適切な即時アクションを1つ選んでください。

利用可能なアクション:
- flee: 危険から逃げる
- eat: 食べ物を食べる
- equip: 武器/防具を装備
- attack: 敵を攻撃
- dig_up: 上に掘って脱出
- swim_up: 水面に泳ぐ
- none: 何もしない

JSON形式で回答: {"type": "アクション名", "target": "対象(任意)"}`;

        const context = this.buildContext(eventData);

        try {
            const response = await this.llm.invoke([
                new SystemMessage(systemPrompt),
                new HumanMessage(context),
            ]);

            const content = response.content.toString();
            const jsonMatch = content.match(/\{[^}]+\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]) as EmergencyAction;
            }
        } catch (error) {
            log.error('LLM緊急判断エラー', error);
        }

        return { type: 'none' };
    }

    /**
     * コンテキストを構築
     */
    private buildContext(eventData: EventData): string {
        const health = this.bot.health?.toFixed(1) || '?';
        const food = this.bot.food || 0;
        const hasFood = this.hasFood();
        const hasWeapon = this.hasWeapon();

        let context = `現在の状態: HP=${health}/20, 満腹度=${food}/20\n`;
        context += `インベントリ: 食べ物=${hasFood ? 'あり' : 'なし'}, 武器=${hasWeapon ? 'あり' : 'なし'}\n`;
        context += `緊急事態: ${JSON.stringify(eventData)}\n`;
        context += `何をすべき？`;

        return context;
    }

    /**
     * アクションを実行
     */
    private async executeAction(action: EmergencyAction): Promise<void> {
        log.warn(`🚨 緊急アクション実行: ${action.type}`);

        switch (action.type) {
            case 'flee':
                await this.executeFlee(action.direction);
                break;
            case 'eat':
                await this.executeEat();
                break;
            case 'equip':
                await this.executeEquip(action.target);
                break;
            case 'attack':
                await this.executeAttack(action.target);
                break;
            case 'dig_up':
                await this.executeDigUp();
                break;
            case 'swim_up':
                await this.executeSwimUp();
                break;
            case 'none':
            default:
                log.debug('緊急アクション: 何もしない');
                break;
        }
    }

    /**
     * 逃げる
     */
    private async executeFlee(direction?: { x: number; y: number; z: number }): Promise<void> {
        try {
            // 現在のパスファインダーを停止
            this.bot.pathfinder?.stop();

            // 方向が指定されていない場合はランダム
            const dir = direction || {
                x: (Math.random() - 0.5) * 2,
                y: 0,
                z: (Math.random() - 0.5) * 2,
            };

            // その方向を向いて走る
            const targetPos = this.bot.entity.position.offset(dir.x * 10, 0, dir.z * 10);
            await this.bot.lookAt(targetPos);

            this.bot.setControlState('forward', true);
            this.bot.setControlState('sprint', true);

            // 3秒間走る
            await new Promise(resolve => setTimeout(resolve, 3000));

            this.bot.setControlState('forward', false);
            this.bot.setControlState('sprint', false);

            log.success('✅ 逃走完了');
        } catch (error) {
            log.error('逃走エラー', error);
        }
    }

    /**
     * 食べる
     */
    private async executeEat(): Promise<void> {
        try {
            const food = this.findFood();
            if (food) {
                await this.bot.equip(food, 'hand');
                await this.bot.consume();
                log.success(`✅ ${food.name}を食べた`);
            }
        } catch (error) {
            log.error('食事エラー', error);
        }
    }

    /**
     * 装備する
     */
    private async executeEquip(target?: string): Promise<void> {
        try {
            if (target === 'weapon') {
                const weapon = this.findWeapon();
                if (weapon) {
                    await this.bot.equip(weapon, 'hand');
                    log.success(`✅ ${weapon.name}を装備`);
                }
            }
        } catch (error) {
            log.error('装備エラー', error);
        }
    }

    /**
     * 攻撃する
     */
    private async executeAttack(target?: string): Promise<void> {
        try {
            // 最も近い敵対Mobを攻撃
            const hostile = this.findNearestHostile();
            if (hostile) {
                await this.bot.attack(hostile);
                log.success(`✅ ${hostile.name}を攻撃`);
            }
        } catch (error) {
            log.error('攻撃エラー', error);
        }
    }

    /**
     * 上に掘る
     */
    private async executeDigUp(): Promise<void> {
        try {
            const abovePos = this.bot.entity.position.offset(0, 2, 0);
            const block = this.bot.blockAt(abovePos);

            if (block && block.name !== 'air') {
                await this.bot.dig(block);
                this.bot.setControlState('jump', true);
                await new Promise(resolve => setTimeout(resolve, 500));
                this.bot.setControlState('jump', false);
                log.success('✅ 上に掘って脱出');
            }
        } catch (error) {
            log.error('掘削エラー', error);
        }
    }

    /**
     * 水面に泳ぐ
     */
    private async executeSwimUp(): Promise<void> {
        try {
            this.bot.setControlState('jump', true);

            // 5秒間泳ぐ
            await new Promise(resolve => setTimeout(resolve, 5000));

            this.bot.setControlState('jump', false);
            log.success('✅ 水面に浮上');
        } catch (error) {
            log.error('水泳エラー', error);
        }
    }

    // ユーティリティメソッド

    private hasFood(): boolean {
        const foodItems = ['bread', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken',
            'cooked_mutton', 'cooked_rabbit', 'cooked_cod', 'cooked_salmon',
            'apple', 'golden_apple', 'carrot', 'baked_potato', 'melon_slice'];
        return this.bot.inventory.items().some(item =>
            foodItems.some(food => item.name.includes(food))
        );
    }

    private findFood(): any {
        const foodItems = ['golden_apple', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken',
            'bread', 'cooked_mutton', 'cooked_rabbit', 'cooked_cod', 'cooked_salmon',
            'apple', 'carrot', 'baked_potato', 'melon_slice'];
        for (const foodName of foodItems) {
            const food = this.bot.inventory.items().find(item => item.name.includes(foodName));
            if (food) return food;
        }
        return null;
    }

    private hasWeapon(): boolean {
        const weapons = ['sword', 'axe'];
        return this.bot.inventory.items().some(item =>
            weapons.some(w => item.name.includes(w))
        );
    }

    private findWeapon(): any {
        const weapons = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword',
            'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'];
        for (const weaponName of weapons) {
            const weapon = this.bot.inventory.items().find(item => item.name === weaponName);
            if (weapon) return weapon;
        }
        return null;
    }

    private findNearestHostile(): any {
        const hostileMobs = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman'];
        let nearest: any = null;
        let minDistance = Infinity;

        Object.values(this.bot.entities).forEach(entity => {
            if (entity.id === this.bot.entity.id) return;
            const mobName = entity.name?.toLowerCase() || '';
            if (!hostileMobs.some(h => mobName.includes(h))) return;

            const distance = this.bot.entity.position.distanceTo(entity.position);
            if (distance < minDistance) {
                minDistance = distance;
                nearest = entity;
            }
        });

        return nearest;
    }

    private calculateFleeDirection(threatPos?: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
        if (threatPos) {
            // 脅威と反対方向
            const botPos = this.bot.entity.position;
            const dx = botPos.x - threatPos.x;
            const dz = botPos.z - threatPos.z;
            const len = Math.sqrt(dx * dx + dz * dz) || 1;
            return { x: dx / len, y: 0, z: dz / len };
        }

        // ランダム方向
        const angle = Math.random() * Math.PI * 2;
        return { x: Math.cos(angle), y: 0, z: Math.sin(angle) };
    }
}


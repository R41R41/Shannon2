/**
 * EventReactionSystem
 * イベント反応を管理するシステム
 */

import { TaskGraph } from '../llm/graph/taskGraph.js';
import { CustomBot } from '../types.js';
import { EmergencyResponder } from './EmergencyResponder.js';
import {
    BiomeEventData,
    DamageEventData,
    DEFAULT_REACTION_CONFIGS,
    EventData,
    EventReactionConfig,
    EventReactionResult,
    EventType,
    HostileEventData,
    ItemEventData,
    PlayerEventData,
    ReactionSettingsState,
    SuffocationEventData,
    TeleportEventData,
    TimeEventData,
    WeatherEventData,
} from './types.js';

export class EventReactionSystem {
    private bot: CustomBot;
    private taskGraph: TaskGraph | null = null;
    private emergencyResponder: EmergencyResponder;
    private configs: Map<EventType, EventReactionConfig>;

    // 状態追跡
    private lastTime: 'day' | 'noon' | 'evening' | 'night' = 'day';
    private lastWeather: 'clear' | 'rain' | 'thunder' = 'clear';
    private lastBiome: string = '';
    private lastPosition: { x: number; y: number; z: number } | null = null;
    private lastInventory: Map<string, number> = new Map();
    private trackedHostiles: Set<number> = new Set(); // エンティティID

    // インターバルID
    private environmentCheckInterval: NodeJS.Timeout | null = null;
    private hostileCheckInterval: NodeJS.Timeout | null = null;

    constructor(bot: CustomBot) {
        this.bot = bot;
        this.emergencyResponder = new EmergencyResponder(bot);
        this.configs = new Map();

        // デフォルト設定を読み込み
        DEFAULT_REACTION_CONFIGS.forEach(config => {
            this.configs.set(config.eventType, { ...config });
        });
    }

    /**
     * 初期化
     */
    async initialize(): Promise<void> {
        this.taskGraph = TaskGraph.getInstance();
        await this.emergencyResponder.initialize();

        // botがspawn済みの場合のみ初期状態を記録
        if (this.bot.entity) {
            this.updateInitialState();
            // 定期チェックを開始
            this.startEnvironmentCheck();
            this.startHostileCheck();
        } else {
            // spawnを待ってから初期化
            this.bot.once('spawn', () => {
                this.updateInitialState();
                this.startEnvironmentCheck();
                this.startHostileCheck();
                console.log('✅ EventReactionSystem started after spawn');
            });
        }

        console.log('✅ EventReactionSystem initialized');
    }

    /**
     * 初期状態を記録
     */
    private updateInitialState(): void {
        if (!this.bot.entity) {
            console.warn('⚠️ bot.entity not available yet');
            return;
        }

        // 時間
        this.lastTime = this.getCurrentTimeOfDay();

        // 天気
        this.lastWeather = this.getCurrentWeather();

        // バイオーム
        try {
            const biome = (this.bot as any).world?.getBiome?.(this.bot.entity.position);
            this.lastBiome = typeof biome === 'object' ? (biome?.name || '') : String(biome || '');
        } catch {
            this.lastBiome = '';
        }

        // 位置
        const pos = this.bot.entity.position;
        this.lastPosition = { x: pos.x, y: pos.y, z: pos.z };

        // インベントリ
        this.updateInventorySnapshot();
    }

    /**
     * インベントリのスナップショットを更新
     */
    private updateInventorySnapshot(): void {
        this.lastInventory.clear();
        this.bot.inventory.items().forEach(item => {
            const current = this.lastInventory.get(item.name) || 0;
            this.lastInventory.set(item.name, current + item.count);
        });
    }

    /**
     * 現在の時間帯を取得
     */
    private getCurrentTimeOfDay(): 'day' | 'noon' | 'evening' | 'night' {
        const time = this.bot.time.timeOfDay;
        if (time >= 0 && time < 6000) return 'day';
        if (time >= 6000 && time < 12000) return 'noon';
        if (time >= 12000 && time < 13000) return 'evening';
        return 'night';
    }

    /**
     * 現在の天気を取得
     */
    private getCurrentWeather(): 'clear' | 'rain' | 'thunder' {
        const bot = this.bot as any;
        if (bot.thunderState > 0) return 'thunder';
        if (bot.rainState > 0 || bot.isRaining) return 'rain';
        return 'clear';
    }

    /**
     * ボットがidle状態かどうか
     */
    private isIdle(): boolean {
        return !this.taskGraph?.isRunning() && !this.bot.executingSkill;
    }

    /**
     * 確率チェック
     */
    private checkProbability(probability: number): boolean {
        return Math.random() * 100 < probability;
    }

    /**
     * 設定を取得
     */
    getConfig(eventType: EventType): EventReactionConfig | undefined {
        return this.configs.get(eventType);
    }

    /**
     * 設定を更新
     */
    updateConfig(eventType: EventType, updates: Partial<EventReactionConfig>): void {
        const config = this.configs.get(eventType);
        if (config) {
            Object.assign(config, updates);
        }
    }

    /**
     * 全設定をリセット
     */
    resetConfigs(): void {
        DEFAULT_REACTION_CONFIGS.forEach(config => {
            this.configs.set(config.eventType, { ...config });
        });
    }

    /**
     * 設定状態を取得（UI用）
     */
    getSettingsState(): ReactionSettingsState {
        const reactions = Array.from(this.configs.values());
        const constantSkills = this.bot.constantSkills.getSkills().map(skill => ({
            skillName: skill.skillName,
            enabled: skill.status,
            description: skill.description,
        }));
        return { reactions, constantSkills };
    }

    /**
     * 環境チェックを開始
     */
    private startEnvironmentCheck(): void {
        this.environmentCheckInterval = setInterval(() => {
            this.checkTimeChange();
            this.checkWeatherChange();
            this.checkBiomeChange();
            this.checkTeleport();
            this.checkInventoryChange();
        }, 1000); // 1秒ごと
    }

    /**
     * 敵対Mobチェックを開始
     */
    private startHostileCheck(): void {
        this.hostileCheckInterval = setInterval(() => {
            this.checkHostileApproach();
        }, 500); // 0.5秒ごと
    }

    /**
     * 時間変化をチェック
     */
    private async checkTimeChange(): Promise<void> {
        const currentTime = this.getCurrentTimeOfDay();
        if (currentTime !== this.lastTime) {
            const eventData: TimeEventData = {
                timestamp: Date.now(),
                eventType: 'time_change',
                previousTime: this.lastTime,
                currentTime,
                tickTime: this.bot.time.timeOfDay,
            };
            this.lastTime = currentTime;
            await this.handleEvent(eventData);
        }
    }

    /**
     * 天気変化をチェック
     */
    private async checkWeatherChange(): Promise<void> {
        const currentWeather = this.getCurrentWeather();
        if (currentWeather !== this.lastWeather) {
            const eventData: WeatherEventData = {
                timestamp: Date.now(),
                eventType: 'weather_change',
                previousWeather: this.lastWeather,
                currentWeather,
            };
            this.lastWeather = currentWeather;
            await this.handleEvent(eventData);
        }
    }

    // 珍しい/特別なバイオーム
    private static readonly RARE_BIOMES = new Set([
        'mushroom_fields', 'mushroom_field_shore',
        'cherry_grove',
        'deep_dark',
        'lush_caves', 'dripstone_caves',
        'ice_spikes', 'frozen_peaks', 'jagged_peaks', 'stony_peaks',
        'bamboo_jungle', 'sparse_jungle',
        'mangrove_swamp',
        'badlands', 'wooded_badlands', 'eroded_badlands',
        'warm_ocean', 'lukewarm_ocean', 'deep_lukewarm_ocean',
        'flower_forest', 'old_growth_birch_forest', 'old_growth_pine_taiga', 'old_growth_spruce_taiga',
        'meadow', 'grove', 'snowy_slopes',
        'the_end', 'end_highlands', 'end_midlands', 'end_barrens', 'small_end_islands',
        'nether_wastes', 'soul_sand_valley', 'crimson_forest', 'warped_forest', 'basalt_deltas',
    ]);

    // 一般的すぎるバイオーム（反応しない）
    private static readonly COMMON_BIOMES = new Set([
        'plains', 'river', 'ocean', 'deep_ocean', 'frozen_river', 'frozen_ocean',
        'beach', 'stony_shore', 'snowy_beach',
    ]);

    /**
     * バイオーム変化をチェック
     */
    private async checkBiomeChange(): Promise<void> {
        let currentBiome = '';
        try {
            const biome = (this.bot as any).world?.getBiome?.(this.bot.entity.position);
            currentBiome = typeof biome === 'object' ? (biome?.name || '') : String(biome || '');
        } catch {
            return;
        }

        if (currentBiome && currentBiome !== this.lastBiome) {
            const previousBiome = this.lastBiome;
            this.lastBiome = currentBiome;

            // 一般的なバイオームはスキップ
            if (EventReactionSystem.COMMON_BIOMES.has(currentBiome.toLowerCase())) {
                return;
            }

            const eventData: BiomeEventData = {
                timestamp: Date.now(),
                eventType: 'biome_change',
                previousBiome,
                currentBiome,
                isRare: EventReactionSystem.RARE_BIOMES.has(currentBiome.toLowerCase()),
            };
            await this.handleEvent(eventData);
        }
    }

    /**
     * テレポートをチェック
     */
    private async checkTeleport(): Promise<void> {
        const pos = this.bot.entity.position;
        const current = { x: pos.x, y: pos.y, z: pos.z };

        if (this.lastPosition) {
            const dx = current.x - this.lastPosition.x;
            const dy = current.y - this.lastPosition.y;
            const dz = current.z - this.lastPosition.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

            // 50ブロック以上の移動はテレポートとみなす
            if (distance > 50) {
                const eventData: TeleportEventData = {
                    timestamp: Date.now(),
                    eventType: 'teleported',
                    previousPosition: this.lastPosition,
                    currentPosition: current,
                    distance,
                };
                await this.handleEvent(eventData);
            }
        }

        this.lastPosition = current;
    }

    /**
     * インベントリ変化をチェック
     */
    private async checkInventoryChange(): Promise<void> {
        const newInventory = new Map<string, number>();
        this.bot.inventory.items().forEach(item => {
            const current = newInventory.get(item.name) || 0;
            newInventory.set(item.name, current + item.count);
        });

        // 増加したアイテムを検出
        for (const [itemName, newCount] of newInventory) {
            const oldCount = this.lastInventory.get(itemName) || 0;
            if (newCount > oldCount) {
                const gained = newCount - oldCount;

                // 近くのプレイヤー・エンティティを取得
                const nearbyPlayers: string[] = [];
                const nearbyEntities: string[] = [];

                Object.values(this.bot.entities).forEach(entity => {
                    const distance = this.bot.entity.position.distanceTo(entity.position);
                    if (distance <= 10 && entity.id !== this.bot.entity.id) {
                        if (entity.type === 'player') {
                            nearbyPlayers.push(entity.username || 'unknown');
                        } else {
                            const entityName = (entity as any).name || entity.type || 'unknown';
                            nearbyEntities.push(String(entityName));
                        }
                    }
                });

                const eventData: ItemEventData = {
                    timestamp: Date.now(),
                    eventType: 'item_obtained',
                    itemName,
                    count: gained,
                    source: 'unknown', // 実際のソースは追跡が難しい
                    nearbyPlayers,
                    nearbyEntities,
                };

                await this.handleEvent(eventData);
            }
        }

        this.lastInventory = newInventory;
    }

    /**
     * 敵対Mob接近をチェック
     */
    private async checkHostileApproach(): Promise<void> {
        const hostileMobs = [
            'zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch',
            'phantom', 'drowned', 'husk', 'stray', 'blaze', 'ghast',
            'magma_cube', 'slime', 'pillager', 'vindicator', 'evoker',
            'warden', 'piglin_brute', 'hoglin', 'zoglin',
        ];

        const nearbyHostiles: { entity: any; distance: number }[] = [];

        Object.values(this.bot.entities).forEach(entity => {
            if (entity.id === this.bot.entity.id) return;

            const mobName = String((entity as any).name || '').toLowerCase();
            if (!hostileMobs.some(h => mobName.includes(h))) return;

            const distance = this.bot.entity.position.distanceTo(entity.position);
            if (distance <= 10) {
                nearbyHostiles.push({ entity, distance });
            }
        });

        // 新しく検出された敵対Mobがいるかチェック
        const newHostiles = nearbyHostiles.filter(h => !this.trackedHostiles.has(h.entity.id));

        if (newHostiles.length > 0) {
            // 最も近い敵対Mob
            const nearest = newHostiles.reduce((a, b) => a.distance < b.distance ? a : b);

            const eventData: HostileEventData = {
                timestamp: Date.now(),
                eventType: 'hostile_approach',
                mobType: String((nearest.entity as any).name || 'unknown'),
                mobPosition: {
                    x: nearest.entity.position.x,
                    y: nearest.entity.position.y,
                    z: nearest.entity.position.z,
                },
                distance: nearest.distance,
                mobCount: nearbyHostiles.length,
            };

            await this.handleEvent(eventData);
        }

        // トラッキングを更新
        this.trackedHostiles.clear();
        nearbyHostiles.forEach(h => this.trackedHostiles.add(h.entity.id));
    }

    /**
     * プレイヤーがボットの方を向いているかチェック
     */
    checkPlayerFacing(playerEntity: any): boolean {
        if (!playerEntity || !playerEntity.yaw) return false;

        const botPos = this.bot.entity.position;
        const playerPos = playerEntity.position;

        // プレイヤーからボットへの方向を計算
        const dx = botPos.x - playerPos.x;
        const dz = botPos.z - playerPos.z;
        const targetYaw = Math.atan2(-dx, dz);

        // プレイヤーの向いている方向との差
        const yawDiff = Math.abs(playerEntity.yaw - targetYaw);
        const normalizedDiff = Math.min(yawDiff, 2 * Math.PI - yawDiff);

        // 45度以内ならボットの方を向いている
        return normalizedDiff < Math.PI / 4;
    }

    /**
     * プレイヤー接近イベントを処理（外部から呼び出し）
     */
    async handlePlayerFacing(playerEntity: any): Promise<void> {
        if (!playerEntity) return;

        const distance = this.bot.entity.position.distanceTo(playerEntity.position);
        if (distance > 3) return; // 3ブロック以内のみ

        if (!this.checkPlayerFacing(playerEntity)) return;

        const eventData: PlayerEventData = {
            timestamp: Date.now(),
            eventType: 'player_facing',
            playerName: playerEntity.username || 'unknown',
            playerPosition: {
                x: playerEntity.position.x,
                y: playerEntity.position.y,
                z: playerEntity.position.z,
            },
            distance,
            isFacingBot: true,
        };

        await this.handleEvent(eventData);
    }

    /**
     * プレイヤー発言イベントを処理（外部から呼び出し）
     */
    async handlePlayerSpeak(playerName: string, message: string, playerEntity?: any): Promise<void> {
        const position = playerEntity?.position || this.bot.entity.position;
        const distance = playerEntity
            ? this.bot.entity.position.distanceTo(playerEntity.position)
            : 0;

        const eventData: PlayerEventData = {
            timestamp: Date.now(),
            eventType: 'player_speak',
            playerName,
            playerPosition: {
                x: position.x,
                y: position.y,
                z: position.z,
            },
            distance,
            message,
        };

        await this.handleEvent(eventData);
    }

    /**
     * ダメージイベントを処理（外部から呼び出し）
     */
    async handleDamage(data: {
        damage: number;
        damagePercent: number;
        currentHealth: number;
        consecutiveCount: number;
    }): Promise<void> {
        const eventData: DamageEventData = {
            timestamp: Date.now(),
            eventType: 'damage',
            ...data,
        };

        await this.handleEvent(eventData);
    }

    /**
     * 窒息イベントを処理（外部から呼び出し）
     */
    async handleSuffocation(data: {
        oxygen: number;
        health: number;
        isInWater: boolean;
    }): Promise<void> {
        const eventData: SuffocationEventData = {
            timestamp: Date.now(),
            eventType: 'suffocation',
            ...data,
        };

        await this.handleEvent(eventData);
    }

    /**
     * イベントを処理
     */
    private async handleEvent(eventData: EventData): Promise<EventReactionResult> {
        const config = this.configs.get(eventData.eventType);

        if (!config || !config.enabled) {
            return { handled: false, reactionType: 'info' };
        }

        // idle時のみの設定でbusy状態ならスキップ
        if (config.idleOnly && !this.isIdle()) {
            // ただし、ダメージイベントは緊急対応
            if (eventData.eventType === 'damage') {
                return this.handleEmergencyEvent(eventData as DamageEventData);
            }

            // アイテム取得はinfo更新のみ
            if (eventData.eventType === 'item_obtained') {
                console.log(`📦 アイテム取得: +${(eventData as ItemEventData).count} ${(eventData as ItemEventData).itemName}`);
                return { handled: true, reactionType: 'info' };
            }

            return { handled: false, reactionType: 'info' };
        }

        // 確率チェック
        if (!this.checkProbability(config.probability)) {
            return { handled: false, reactionType: 'info' };
        }

        // 反応タイプに応じて処理
        switch (config.reactionType) {
            case 'emergency':
                return this.handleEmergencyEvent(eventData);
            case 'task':
                return this.handleTaskEvent(eventData);
            case 'immediate':
                return this.handleImmediateEvent(eventData);
            case 'info':
            default:
                // アイテム取得の特別処理
                if (eventData.eventType === 'item_obtained') {
                    const itemData = eventData as ItemEventData;
                    console.log(`📦 アイテム取得: +${itemData.count} ${itemData.itemName}`);

                    // プレイヤーからもらった場合は使い道を聞く（タスクとして処理）
                    if (itemData.nearbyPlayers && itemData.nearbyPlayers.length > 0) {
                        return this.handleTaskEvent(eventData);
                    }
                }
                return { handled: true, reactionType: 'info' };
        }
    }

    /**
     * 緊急イベントを処理
     */
    private async handleEmergencyEvent(eventData: EventData): Promise<EventReactionResult> {
        const message = this.buildEmergencyMessage(eventData);
        console.log(`\x1b[31m🚨 緊急対応: ${message}\x1b[0m`);

        try {
            const action = await this.emergencyResponder.respond(eventData);
            return { handled: true, reactionType: 'emergency', message, action };
        } catch (error) {
            console.error('緊急対応エラー:', error);
            return { handled: false, reactionType: 'emergency', message };
        }
    }

    /**
     * タスクイベントを処理
     */
    private async handleTaskEvent(eventData: EventData): Promise<EventReactionResult> {
        if (!this.taskGraph) {
            return { handled: false, reactionType: 'task' };
        }

        const message = this.buildTaskMessage(eventData);
        console.log(`📋 タスク生成: ${message}`);

        try {
            await this.taskGraph.invoke({
                userMessage: message,
                isEmergency: false,
            });
            return { handled: true, reactionType: 'task', message };
        } catch (error) {
            console.error('タスク生成エラー:', error);
            return { handled: false, reactionType: 'task', message };
        }
    }

    /**
     * 即時イベントを処理（常時スキルが担当）
     */
    private async handleImmediateEvent(eventData: EventData): Promise<EventReactionResult> {
        // 常時スキルで処理されるので、ここでは何もしない
        return { handled: true, reactionType: 'immediate' };
    }

    /**
     * 緊急メッセージを構築
     */
    private buildEmergencyMessage(eventData: EventData): string {
        switch (eventData.eventType) {
            case 'damage':
                const dmg = eventData as DamageEventData;
                return `ダメージを受けた（-${dmg.damage.toFixed(1)}HP、残り${dmg.currentHealth.toFixed(1)}/20）。安全を確保して`;
            case 'suffocation':
                const suff = eventData as SuffocationEventData;
                return `窒息中（酸素:${suff.oxygen}/300）。すぐに脱出して`;
            default:
                return '緊急事態が発生した';
        }
    }

    /**
     * タスクメッセージを構築
     */
    private buildTaskMessage(eventData: EventData): string {
        switch (eventData.eventType) {
            case 'player_facing':
                const pf = eventData as PlayerEventData;
                return `${pf.playerName}が近くに来た。挨拶して`;
            case 'player_speak':
                const ps = eventData as PlayerEventData;
                return `${ps.playerName}「${ps.message}」`;
            case 'hostile_approach':
                const ha = eventData as HostileEventData;
                return `${ha.mobType}が${ha.distance.toFixed(1)}ブロック先にいる。${ha.mobCount > 1 ? `（合計${ha.mobCount}体）` : ''}対処して`;
            case 'item_obtained':
                const io = eventData as ItemEventData;
                if (io.nearbyPlayers && io.nearbyPlayers.length > 0) {
                    const giver = io.nearbyPlayers[0];
                    return `${giver}から${io.itemName}を${io.count}個もらった。お礼を言って、何に使えばいいか聞いて。ただし食べ物でお腹が空いていたら食べていい`;
                }
                return `${io.itemName}を${io.count}個入手した`;
            case 'time_change':
                const tc = eventData as TimeEventData;
                const timeNames = { day: '朝', noon: '昼', evening: '夕方', night: '夜' };
                return `${timeNames[tc.currentTime]}になった`;
            case 'weather_change':
                const wc = eventData as WeatherEventData;
                const weatherNames = { clear: '晴れ', rain: '雨', thunder: '雷雨' };
                return `天気が${weatherNames[wc.currentWeather]}に変わった`;
            case 'biome_change':
                const bc = eventData as BiomeEventData;
                if (bc.isRare) {
                    return `${bc.currentBiome}バイオームに入った！珍しい場所だ。周りを見回して、何か面白いものがあれば感想を言って`;
                }
                return `${bc.currentBiome}バイオームに入った。周りを見回して、何か印象的なものがあれば一言感想を言って`;
            case 'teleported':
                const tp = eventData as TeleportEventData;
                return `テレポートされた（${tp.distance.toFixed(0)}ブロック移動）。周囲を確認して`;
            case 'damage':
                const dmg = eventData as DamageEventData;
                return `ダメージを受けた（-${dmg.damage.toFixed(1)}HP）。状況を確認して`;
            default:
                return 'イベントが発生した';
        }
    }

    /**
     * クリーンアップ
     */
    destroy(): void {
        if (this.environmentCheckInterval) {
            clearInterval(this.environmentCheckInterval);
            this.environmentCheckInterval = null;
        }
        if (this.hostileCheckInterval) {
            clearInterval(this.hostileCheckInterval);
            this.hostileCheckInterval = null;
        }
    }
}


/**
 * イベント反応システムの型定義
 */

/**
 * イベントタイプ
 */
export type EventType =
    | 'player_facing'      // 近くに来た人に話しかける（idle時のみ）
    | 'player_speak'       // チャットに反応
    | 'hostile_approach'   // 敵対Mobが近づいてきた
    | 'item_obtained'      // アイテム取得
    | 'time_change'        // 時間帯変化
    | 'weather_change'     // 天気変化
    | 'biome_change'       // バイオーム変化
    | 'teleported'         // テレポート検知
    | 'damage'             // ダメージを受けた
    | 'suffocation';       // 窒息

/**
 * 反応タイプ
 */
export type ReactionType =
    | 'immediate'   // 即時実行（常時スキルで対応）
    | 'task'        // TaskGraphに渡す
    | 'emergency'   // 緊急対応（EmergencyResponder）
    | 'info';       // 情報更新のみ

/**
 * イベント反応の設定
 */
export interface EventReactionConfig {
    eventType: EventType;
    enabled: boolean;
    probability: number;       // 0-100
    idleOnly: boolean;         // idle時のみ反応
    reactionType: ReactionType;
}

/**
 * デフォルト設定
 */
export const DEFAULT_REACTION_CONFIGS: EventReactionConfig[] = [
    { eventType: 'player_facing', enabled: true, probability: 30, idleOnly: true, reactionType: 'task' },
    { eventType: 'player_speak', enabled: true, probability: 100, idleOnly: false, reactionType: 'task' },
    { eventType: 'hostile_approach', enabled: true, probability: 100, idleOnly: true, reactionType: 'task' }, // 戦闘中は割り込まない
    { eventType: 'item_obtained', enabled: true, probability: 30, idleOnly: true, reactionType: 'info' }, // タスク生成しない（ログのみ）
    { eventType: 'time_change', enabled: true, probability: 30, idleOnly: true, reactionType: 'task' }, // idle時のみ
    { eventType: 'weather_change', enabled: true, probability: 30, idleOnly: true, reactionType: 'task' }, // idle時のみ
    { eventType: 'biome_change', enabled: true, probability: 50, idleOnly: true, reactionType: 'task' }, // idle時のみ（無限ループ防止）
    { eventType: 'teleported', enabled: true, probability: 100, idleOnly: true, reactionType: 'task' }, // idle時のみ
    { eventType: 'damage', enabled: true, probability: 100, idleOnly: false, reactionType: 'emergency' }, // 常に緊急タスクとして処理
    { eventType: 'suffocation', enabled: true, probability: 100, idleOnly: false, reactionType: 'emergency' },
];

/**
 * イベントデータの基本型
 */
export interface BaseEventData {
    timestamp: number;
    eventType: EventType;
}

/**
 * プレイヤー関連イベントデータ
 */
export interface PlayerEventData extends BaseEventData {
    eventType: 'player_facing' | 'player_speak';
    playerName: string;
    playerPosition: { x: number; y: number; z: number };
    distance: number;
    message?: string;           // player_speakの場合
    isFacingBot?: boolean;      // player_facingの場合
}

/**
 * 敵対Mob接近イベントデータ
 */
export interface HostileEventData extends BaseEventData {
    eventType: 'hostile_approach';
    mobType: string;
    mobPosition: { x: number; y: number; z: number };
    distance: number;
    mobCount: number;
}

/**
 * アイテム取得イベントデータ
 */
export interface ItemEventData extends BaseEventData {
    eventType: 'item_obtained';
    itemName: string;
    count: number;
    source: 'pickup' | 'craft' | 'mine' | 'trade' | 'unknown';
    nearbyEntities?: string[];
    nearbyPlayers?: string[];
}

/**
 * 時間変化イベントデータ
 */
export interface TimeEventData extends BaseEventData {
    eventType: 'time_change';
    previousTime: 'day' | 'noon' | 'evening' | 'night';
    currentTime: 'day' | 'noon' | 'evening' | 'night';
    tickTime: number;
}

/**
 * 天気変化イベントデータ
 */
export interface WeatherEventData extends BaseEventData {
    eventType: 'weather_change';
    previousWeather: 'clear' | 'rain' | 'thunder';
    currentWeather: 'clear' | 'rain' | 'thunder';
}

/**
 * バイオーム変化イベントデータ
 */
export interface BiomeEventData extends BaseEventData {
    eventType: 'biome_change';
    previousBiome: string;
    currentBiome: string;
    isRare?: boolean; // 珍しいバイオームかどうか
}

/**
 * テレポートイベントデータ
 */
export interface TeleportEventData extends BaseEventData {
    eventType: 'teleported';
    previousPosition: { x: number; y: number; z: number };
    currentPosition: { x: number; y: number; z: number };
    distance: number;
}

/**
 * ダメージイベントデータ
 */
export interface DamageEventData extends BaseEventData {
    eventType: 'damage';
    damage: number;
    damagePercent: number;
    currentHealth: number;
    consecutiveCount: number;
    possibleSource?: string;    // 攻撃元（わかる場合）
}

/**
 * 窒息イベントデータ
 */
export interface SuffocationEventData extends BaseEventData {
    eventType: 'suffocation';
    oxygen: number;
    health: number;
    isInWater: boolean;
}

/**
 * 全イベントデータの統合型
 */
export type EventData =
    | PlayerEventData
    | HostileEventData
    | ItemEventData
    | TimeEventData
    | WeatherEventData
    | BiomeEventData
    | TeleportEventData
    | DamageEventData
    | SuffocationEventData;

/**
 * イベント反応結果
 */
export interface EventReactionResult {
    handled: boolean;
    reactionType: ReactionType;
    message?: string;
    action?: string;
}

/**
 * 設定状態（UI用）
 */
export interface ReactionSettingsState {
    reactions: EventReactionConfig[];
    constantSkills: {
        skillName: string;
        enabled: boolean;
        description: string;
    }[];
}


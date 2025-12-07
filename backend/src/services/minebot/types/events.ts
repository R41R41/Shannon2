/**
 * イベント関連の型定義
 */

/**
 * Botイベントハンドラーのタイプ
 */
export type BotEventType =
    | 'entitySpawn'
    | 'entityHurt'
    | 'health'
    | 'blockUpdate'
    | 'entityMoved'
    | 'bossBarCreated'
    | 'bossBarUpdated'
    | 'bossBarDeleted';

/**
 * ボスバー情報
 */
export interface BossbarInfo {
    title: string;
    health: number;
    color: string;
    isDragonBar: boolean;
}

/**
 * イベントハンドラーの設定
 */
export interface EventHandlerConfig {
    enabled: boolean;
    priority?: number;
    throttle?: number; // ミリ秒
}


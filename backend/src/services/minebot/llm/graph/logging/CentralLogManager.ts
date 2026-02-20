import fetch from 'node-fetch';
import { createLogger } from '../../../../../utils/logger.js';
import { DetailedLog, LogManager } from './detailedLogTypes.js';
import { CONFIG } from '../../../config/MinebotConfig.js';

const log = createLogger('Minebot:CentralLog');

/**
 * Central Log Manager
 * 全ノードのログを一元管理し、UIへの送信を統括
 */
export class CentralLogManager {
    private static instance: CentralLogManager;
    private logManagers: Map<string, LogManager> = new Map();
    private lastSentTimestamp: Date = new Date(0);
    private currentGoal: string = '';

    private constructor() {
        // シングルトンパターン
    }

    static getInstance(): CentralLogManager {
        if (!CentralLogManager.instance) {
            CentralLogManager.instance = new CentralLogManager();
        }
        return CentralLogManager.instance;
    }

    /**
     * 特定のノード用のLogManagerを取得
     */
    getLogManager(nodeId: string): LogManager {
        if (!this.logManagers.has(nodeId)) {
            this.logManagers.set(nodeId, new LogManager());
        }
        return this.logManagers.get(nodeId)!;
    }

    /**
     * 全ノードのログを時系列順に取得
     */
    getAllLogs(): DetailedLog[] {
        const allLogs: DetailedLog[] = [];
        for (const manager of this.logManagers.values()) {
            allLogs.push(...manager.getLogs());
        }
        // タイムスタンプでソート
        return allLogs.sort(
            (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
        );
    }

    /**
     * 最新のログを取得
     */
    getRecentLogs(count: number): DetailedLog[] {
        const allLogs = this.getAllLogs();
        return allLogs.slice(-count);
    }

    /**
     * 新しいログのみを取得
     */
    getNewLogs(): DetailedLog[] {
        const allLogs = this.getAllLogs();
        return allLogs.filter(log => log.timestamp > this.lastSentTimestamp);
    }

    /**
     * 現在のゴールを設定
     */
    setCurrentGoal(goal: string): void {
        this.currentGoal = goal;
    }

    /**
     * 新しいログのみをUIに送信
     */
    async sendNewLogsToUI(): Promise<void> {
        const newLogs = this.getNewLogs();

        if (newLogs.length === 0) {
            return; // 新しいログがなければ何もしない
        }

        await this.sendLogsToUI(newLogs);

        // 最後に送信したタイムスタンプを更新
        if (newLogs.length > 0) {
            this.lastSentTimestamp = newLogs[newLogs.length - 1].timestamp;
        }
    }

    /**
     * すべてのログをUIに送信
     */
    async sendAllLogsToUI(): Promise<void> {
        const logs = this.getRecentLogs(100);
        await this.sendLogsToUI(logs);
    }

    /**
     * ログをUIに送信（内部実装）
     */
    private async sendLogsToUI(logs: DetailedLog[]): Promise<void> {
        if (logs.length === 0) return;

        try {
            const logsForUI = logs.map(log => ({
                timestamp: log.timestamp.toISOString(),
                phase: log.phase,
                level: log.level,
                source: log.source,
                content: log.content,
                metadata: log.metadata,
            }));

            await fetch(`${CONFIG.UI_MOD_BASE_URL}/task_logs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=UTF-8' },
                body: JSON.stringify({
                    goal: this.currentGoal || 'Unknown goal',
                    logs: logsForUI,
                }),
            });

            log.debug(`📤 Sent ${logs.length} logs to UI`);
        } catch (error) {
            log.error('❌ UIへのログ送信に失敗', error);
        }
    }

    /**
     * 全てのログをクリア
     */
    clearAllLogs(): void {
        for (const manager of this.logManagers.values()) {
            manager.clearLogs();
        }
        this.lastSentTimestamp = new Date(0);
    }

    /**
     * 特定ノードのログをクリア
     */
    clearNodeLogs(nodeId: string): void {
        const manager = this.logManagers.get(nodeId);
        if (manager) {
            manager.clearLogs();
        }
    }

    /**
     * エラーログのみを取得
     */
    getErrors(): DetailedLog[] {
        const allLogs = this.getAllLogs();
        return allLogs.filter(log => log.level === 'error');
    }

    /**
     * 特定フェーズのログを取得
     */
    getLogsByPhase(phase: string): DetailedLog[] {
        const allLogs = this.getAllLogs();
        return allLogs.filter(log => log.phase === phase);
    }

    /**
     * ノード別のログ統計を取得
     */
    getLogStatistics(): Map<string, { total: number; errors: number; success: number }> {
        const stats = new Map<string, { total: number; errors: number; success: number }>();

        for (const [nodeId, manager] of this.logManagers.entries()) {
            const logs = manager.getLogs();
            const errors = logs.filter(l => l.level === 'error').length;
            const success = logs.filter(l => l.level === 'success').length;

            stats.set(nodeId, {
                total: logs.length,
                errors,
                success,
            });
        }

        return stats;
    }
}


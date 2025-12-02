import fetch from 'node-fetch';
import { DetailedLog, LogManager } from './index.js';

/**
 * ログを集約してUIに送信するユーティリティ
 */
export class LogSender {
    private static instance: LogSender;
    private logManager: LogManager;
    private lastSentTimestamp: Date = new Date(0);

    private constructor() {
        this.logManager = new LogManager();
    }

    static getInstance(): LogSender {
        if (!LogSender.instance) {
            LogSender.instance = new LogSender();
        }
        return LogSender.instance;
    }

    addLog(log: Omit<DetailedLog, 'timestamp'>): void {
        this.logManager.addLog(log);
    }

    /**
     * 新しいログのみをUIに送信
     */
    async sendNewLogsToUI(goal?: string): Promise<void> {
        const allLogs = this.logManager.getLogs();

        // 最後に送信したタイムスタンプ以降のログのみを取得
        const newLogs = allLogs.filter(
            log => log.timestamp > this.lastSentTimestamp
        );

        if (newLogs.length === 0) {
            return; // 新しいログがなければ何もしない
        }

        await this.sendLogsToUI(newLogs, goal);

        // 最後に送信したタイムスタンプを更新
        if (newLogs.length > 0) {
            this.lastSentTimestamp = newLogs[newLogs.length - 1].timestamp;
        }
    }

    /**
     * すべてのログをUIに送信
     */
    async sendAllLogsToUI(goal?: string): Promise<void> {
        const logs = this.logManager.getRecentLogs(100);
        await this.sendLogsToUI(logs, goal);
    }

    /**
     * ログをUIに送信（内部実装）
     */
    private async sendLogsToUI(logs: DetailedLog[], goal?: string): Promise<void> {
        if (logs.length === 0) return;

        try {
            const logsForUI = this.logManager.toUIFormat(logs);

            await fetch('http://localhost:8081/task_logs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=UTF-8' },
                body: JSON.stringify({
                    goal: goal || 'Unknown goal',
                    logs: logsForUI,
                }),
            });

            console.log(`📤 Sent ${logs.length} logs to UI`);
        } catch (error) {
            console.error('❌ Failed to send logs to UI:', error);
        }
    }

    /**
     * ログをクリア
     */
    clearLogs(): void {
        this.logManager.clearLogs();
        this.lastSentTimestamp = new Date(0);
    }

    /**
     * ログを取得
     */
    getLogs(): DetailedLog[] {
        return this.logManager.getLogs();
    }

    /**
     * 最近のログを取得
     */
    getRecentLogs(count: number): DetailedLog[] {
        return this.logManager.getRecentLogs(count);
    }
}


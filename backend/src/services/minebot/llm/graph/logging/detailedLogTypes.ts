// 詳細ログシステムの型定義

export type LogPhase = 'thinking' | 'tool_call' | 'tool_result' | 'reflection' | 'planning' | 'understanding';

export type LogLevel = 'info' | 'success' | 'warning' | 'error';

export interface DetailedLog {
    timestamp: Date;
    phase: LogPhase;
    level: LogLevel;
    source: string; // ノード名やツール名
    content: string;
    metadata?: {
        skillName?: string;
        toolName?: string;
        parameters?: any;
        result?: any;
        duration?: number;
        error?: string;
        [key: string]: any;
    };
}

export interface EnhancedTaskTreeState {
    goal: string;
    strategy: string;
    status: 'pending' | 'in_progress' | 'completed' | 'error';
    error: string | null;
    subTasks: Array<{
        subTaskGoal: string;
        subTaskStrategy: string;
        subTaskStatus: 'pending' | 'in_progress' | 'completed' | 'error';
        subTaskResult: string;
    }>;

    // 新規追加：詳細ログ
    logs: DetailedLog[];

    // 新規追加：現在の思考
    currentThinking?: string;

    // 新規追加：進捗情報
    progress?: {
        completed: number;
        total: number;
    };
}

// ログを整形してUIに送信する形式
export interface LogForUI {
    timestamp: string; // ISO string
    phase: LogPhase;
    level: LogLevel;
    source: string;
    content: string;
    metadata?: any;
}

// ログユーティリティクラス
export class LogManager {
    private logs: DetailedLog[] = [];
    private maxLogs: number = 100; // メモリ節約のため最大100件

    addLog(log: Omit<DetailedLog, 'timestamp'>): DetailedLog {
        const fullLog: DetailedLog = {
            ...log,
            timestamp: new Date(),
        };

        this.logs.push(fullLog);

        // 最大件数を超えたら古いログを削除
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs);
        }

        return fullLog;
    }

    getLogs(): DetailedLog[] {
        return [...this.logs];
    }

    getRecentLogs(count: number): DetailedLog[] {
        return this.logs.slice(-count);
    }

    clearLogs(): void {
        this.logs = [];
    }

    // UIに送信する形式に変換
    toUIFormat(logs: DetailedLog[] = this.logs): LogForUI[] {
        return logs.map(log => ({
            timestamp: log.timestamp.toISOString(),
            phase: log.phase,
            level: log.level,
            source: log.source,
            content: log.content,
            metadata: log.metadata,
        }));
    }

    // ログをフィルタリング
    filterByPhase(phase: LogPhase): DetailedLog[] {
        return this.logs.filter(log => log.phase === phase);
    }

    filterByLevel(level: LogLevel): DetailedLog[] {
        return this.logs.filter(log => log.level === level);
    }

    // エラーログのみを取得
    getErrors(): DetailedLog[] {
        return this.filterByLevel('error');
    }
}


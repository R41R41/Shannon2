/**
 * IHttpServer
 * HTTPサーバーのインターフェース定義
 */

import { Server } from 'http';

export interface IHttpServer {
    /**
     * サーバーを起動
     */
    start(): void;

    /**
     * サーバーを停止
     */
    stop(): Promise<void>;

    /**
     * サーバーインスタンスを取得
     */
    getServer(): Server | null;
}


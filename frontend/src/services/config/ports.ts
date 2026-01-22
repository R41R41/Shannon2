export const isTest = import.meta.env.MODE === "test";
export const isDev = import.meta.env.MODE === "development";

// プロトコルを動的に決定
const protocol = window.location.protocol === "https:" ? "https:" : "http:";
const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";

// 実際のホスト名を使用
const hostname = window.location.hostname; // 'sh4nnon.com' など

// 常にブラウザのURLホストを使用（Nginxでプロキシされるため）
const host = window.location.host;

// WebSocketポート設定 (Shannon-prod用)
const wsBasePorts = isDev
  ? {
    openai: '15021',
    monitoring: '15022',
    scheduler: '15024',
    status: '15023',
    planning: '15025',
    emotion: '15026',
    skill: '15027',
    auth: '15028',
  }
  : isTest
    ? {
      openai: '16010',
      monitoring: '16011',
      scheduler: '16012',
      status: '16013',
      planning: '16014',
      emotion: '16015',
      skill: '16016',
      auth: '16017',
    }
    : null; // 本番はパスベース

// Shannon-prod: 常にパスベースのWebSocketを使用（Nginxでプロキシ）
export const URLS = {
  HTTP_SERVER: `${protocol}//${host}`,
  FRONTEND: `${protocol}//${host}`,
  WEBSOCKET: {
    OPENAI: `${wsProtocol}//${host}/ws/openai`,
    MONITORING: `${wsProtocol}//${host}/ws/monitoring`,
    SCHEDULER: `${wsProtocol}//${host}/ws/scheduler`,
    STATUS: `${wsProtocol}//${host}/ws/status`,
    PLANNING: `${wsProtocol}//${host}/ws/planning`,
    EMOTION: `${wsProtocol}//${host}/ws/emotion`,
    SKILL: `${wsProtocol}//${host}/ws/skill`,
    AUTH: `${wsProtocol}//${host}/ws/auth`,
  },
} as const;

// デバッグ用ログ
console.log("Environment:", import.meta.env.MODE);
console.log("isDev:", isDev);
console.log("isTest:", isTest);
console.log("Hostname:", hostname);
console.log("WebSocket URLs:", URLS.WEBSOCKET);

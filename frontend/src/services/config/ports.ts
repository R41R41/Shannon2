export const isTest = import.meta.env.MODE === "test";
export const isDev = import.meta.env.MODE === "development";

// プロトコルを動的に決定
const protocol = window.location.protocol === "https:" ? "https:" : "http:";
const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";

// 実際のホスト名を使用
const hostname = window.location.hostname; // 'sh4nnon.com' など

// モードに応じてポートを設定
const host = isTest
  ? `${hostname}:14000`
  : isDev
    ? `${hostname}:13000`
    : window.location.host;

// WebSocketポート設定
const wsBasePorts = isDev
  ? {
    openai: '15010',
    monitoring: '15011',
    scheduler: '15018',
    status: '15013',
    planning: '15019',
    emotion: '15020',
    skill: '15016',
    auth: '15017',
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

export const URLS = {
  HTTP_SERVER: `${protocol}//${host}`,
  FRONTEND: `${protocol}//${host}`,
  WEBSOCKET: {
    OPENAI: (isDev || isTest)
      ? `${wsProtocol}//${hostname}:${wsBasePorts!.openai}`
      : `${wsProtocol}//${host}/ws/openai`,
    MONITORING: (isDev || isTest)
      ? `${wsProtocol}//${hostname}:${wsBasePorts!.monitoring}`
      : `${wsProtocol}//${host}/ws/monitoring`,
    SCHEDULER: (isDev || isTest)
      ? `${wsProtocol}//${hostname}:${wsBasePorts!.scheduler}`
      : `${wsProtocol}//${host}/ws/scheduler`,
    STATUS: (isDev || isTest)
      ? `${wsProtocol}//${hostname}:${wsBasePorts!.status}`
      : `${wsProtocol}//${host}/ws/status`,
    PLANNING: (isDev || isTest)
      ? `${wsProtocol}//${hostname}:${wsBasePorts!.planning}`
      : `${wsProtocol}//${host}/ws/planning`,
    EMOTION: (isDev || isTest)
      ? `${wsProtocol}//${hostname}:${wsBasePorts!.emotion}`
      : `${wsProtocol}//${host}/ws/emotion`,
    SKILL: (isDev || isTest)
      ? `${wsProtocol}//${hostname}:${wsBasePorts!.skill}`
      : `${wsProtocol}//${host}/ws/skill`,
    AUTH: (isDev || isTest)
      ? `${wsProtocol}//${hostname}:${wsBasePorts!.auth}`
      : `${wsProtocol}//${host}/ws/auth`,
  },
} as const;

// デバッグ用ログ
console.log("Environment:", import.meta.env.MODE);
console.log("isDev:", isDev);
console.log("isTest:", isTest);
console.log("Hostname:", hostname);
console.log("WebSocket URLs:", URLS.WEBSOCKET);

export const isTest = import.meta.env.MODE === 'test';

// プロトコルを動的に決定
const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

// 実際のホスト名を使用
const hostname = window.location.hostname; // 'sh4nnon.com' など

// テストモード時は別のポートを使用
const host = isTest ? `${hostname}:13000` : window.location.host;

// // WebSocketの接続先を環境に応じて設定
// const wsHost = isTest
//   ? 'localhost' // テスト環境では直接WebSocketポートに接続
//   : host;

// const wsBasePorts = isTest
//   ? {
//       openai: '15010',
//       monitoring: '15011',
//       scheduler: '15012',
//       status: '15013',
//     }
//   : { openai: '5010', monitoring: '5011', scheduler: '5012', status: '5013' };

export const URLS = {
  HTTP_SERVER: `${protocol}//${host}`,
  FRONTEND: `${protocol}//${host}`,
  WEBSOCKET: {
    // テスト環境でもホスト名を使用
    OPENAI: isTest
      ? `${wsProtocol}//${hostname}:15010/ws/openai`
      : `${wsProtocol}//${host}/ws/openai`,
    MONITORING: isTest
      ? `${wsProtocol}//${hostname}:15011/ws/monitoring`
      : `${wsProtocol}//${host}/ws/monitoring`,
    SCHEDULER: isTest
      ? `${wsProtocol}//${hostname}:15012/ws/scheduler`
      : `${wsProtocol}//${host}/ws/scheduler`,
    STATUS: isTest
      ? `${wsProtocol}//${hostname}:15013/ws/status`
      : `${wsProtocol}//${host}/ws/status`,
  },
} as const;

// デバッグ用ログ
console.log('Environment:', import.meta.env.MODE);
console.log('Hostname:', hostname);
console.log('WebSocket URLs:', URLS.WEBSOCKET);

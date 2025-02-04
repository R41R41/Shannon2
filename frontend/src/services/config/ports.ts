export const isTest = import.meta.env.MODE === 'test';

// プロトコルを動的に決定
const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const host = window.location.host;

export const URLS = {
  HTTP_SERVER: `${protocol}//${host}`,
  FRONTEND: `${protocol}//${host}`,
  WEBSOCKET: {
    OPENAI: `${wsProtocol}//${host}/ws/openai`,
    MONITORING: `${wsProtocol}//${host}/ws/monitoring`,
    SCHEDULER: `${wsProtocol}//${host}/ws/scheduler`,
    STATUS: `${wsProtocol}//${host}/ws/status`,
  },
} as const;

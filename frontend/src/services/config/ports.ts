const SERVER_IP_ADDRESS = import.meta.env.VITE_SERVER_IP_ADDRESS;
export const isTest = import.meta.env.MODE === 'test';

export const URLS = {
  HTTP_SERVER: `http://${SERVER_IP_ADDRESS}:${
    isTest
      ? (Number(import.meta.env.VITE_HTTP_PORT) + 10000).toString()
      : import.meta.env.VITE_HTTP_PORT
  }`,
  FRONTEND: `http://${SERVER_IP_ADDRESS}:${
    isTest
      ? (Number(import.meta.env.VITE_FRONTEND_PORT) + 10000).toString()
      : import.meta.env.VITE_FRONTEND_PORT
  }`,
  WEBSOCKET: {
    OPENAI: `ws://${SERVER_IP_ADDRESS}:${
      isTest
        ? (Number(import.meta.env.VITE_WS_OPENAI_PORT) + 10000).toString()
        : import.meta.env.VITE_WS_OPENAI_PORT
    }`,
    MONITORING: `ws://${SERVER_IP_ADDRESS}:${
      isTest
        ? (Number(import.meta.env.VITE_WS_MONITORING_PORT) + 10000).toString()
        : import.meta.env.VITE_WS_MONITORING_PORT
    }`,
    SCHEDULER: `ws://${SERVER_IP_ADDRESS}:${
      isTest
        ? (Number(import.meta.env.VITE_WS_SCHEDULER_PORT) + 10000).toString()
        : import.meta.env.VITE_WS_SCHEDULER_PORT
    }`,
    STATUS: `ws://${SERVER_IP_ADDRESS}:${
      isTest
        ? (Number(import.meta.env.VITE_WS_STATUS_PORT) + 10000).toString()
        : import.meta.env.VITE_WS_STATUS_PORT
    }`,
  },
} as const;

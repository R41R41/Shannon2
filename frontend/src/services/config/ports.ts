const SERVER_IP_ADDRESS = import.meta.env.VITE_SERVER_IP_ADDRESS;

export const URLS = {
  HTTP_SERVER: `http://${SERVER_IP_ADDRESS}:${import.meta.env.VITE_HTTP_PORT}`,
  FRONTEND: `http://${SERVER_IP_ADDRESS}:${import.meta.env.VITE_FRONTEND_PORT}`,
  WEBSOCKET: {
    OPENAI: `ws://${SERVER_IP_ADDRESS}:${import.meta.env.VITE_WS_OPENAI_PORT}`,
    MONITORING: `ws://${SERVER_IP_ADDRESS}:${
      import.meta.env.VITE_WS_MONITORING_PORT
    }`,
  },
} as const;

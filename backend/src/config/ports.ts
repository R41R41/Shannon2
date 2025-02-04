export const PORTS = {
  HTTP_SERVER: process.env.HTTP_PORT || 5000,
  FRONTEND: process.env.FRONTEND_PORT || 5000,
  WEBSOCKET: {
    OPENAI: process.env.WS_OPENAI_PORT || 5010,
    VOICE: process.env.WS_VOICE_PORT || 5020,
    MINECRAFT: process.env.WS_MINECRAFT_PORT || 5030,
    MONITORING: process.env.WS_MONITORING_PORT || 5040,
    SCHEDULE: process.env.WS_SCHEDULE_PORT || 5050,
    STATUS: process.env.WS_STATUS_PORT || 5060,
  },
} as const;

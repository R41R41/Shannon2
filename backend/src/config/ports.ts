export const PORTS = {
  HTTP_SERVER: process.env.HTTP_PORT || 15000,
  FRONTEND: process.env.FRONTEND_PORT || 13000,
  WEBSOCKET: {
    OPENAI: process.env.WS_OPENAI_PORT || 15010,
    VOICE: process.env.WS_VOICE_PORT || 15020,
    MINECRAFT: process.env.WS_MINECRAFT_PORT || 15030,
    MONITORING: process.env.WS_MONITORING_PORT || 15040,
    SCHEDULE: process.env.WS_SCHEDULE_PORT || 15050,
    STATUS: process.env.WS_STATUS_PORT || 15060,
  },
} as const;

export const PORTS = {
  HTTP_SERVER: process.env.HTTP_PORT || 5000,
  FRONTEND: process.env.FRONTEND_PORT || 5000,
  WEBSOCKET: {
    OPENAI: process.env.WS_OPENAI_PORT || 5010,
    VOICE: process.env.WS_VOICE_PORT || 5020,
    MINECRAFT: process.env.WS_MINECRAFT_PORT || 5030,
    MONITORING: process.env.WS_MONITORING_PORT || 5011,
    SCHEDULE: process.env.WS_SCHEDULE_PORT || 5012,
    STATUS: process.env.WS_STATUS_PORT || 5013,
    PLANNING: process.env.WS_PLANNING_PORT || 5014,
    EMOTION: process.env.WS_EMOTION_PORT || 5015,
  },
} as const;

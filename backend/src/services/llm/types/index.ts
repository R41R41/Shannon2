export type Platform = 'web' | 'discord' | 'minecraft' | 'twitter' | 'youtube';
export type ConversationType =
  | 'text'
  | 'voice'
  | 'image'
  | 'realtime_text'
  | 'realtime_voice_append'
  | 'realtime_voice_commit'
  | 'realtime_vad_change';

export interface LLMMessage {
  platform: Platform;
  type: ConversationType;
  content: string;
  context: any;
}

export interface LLMResponse {
  platform: Platform;
  type: ConversationType;
  content: string;
  context: any;
}

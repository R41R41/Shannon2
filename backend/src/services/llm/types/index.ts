export type Platform = 'web' | 'discord' | 'minecraft' | 'twitter' | 'youtube';
export type ConversationType = 'text' | 'voice';

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
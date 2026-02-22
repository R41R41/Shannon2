import axios from 'axios';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

export interface VoicepeakEmotion {
  happy?: number;
  fun?: number;
  angry?: number;
  sad?: number;
}

export interface VoicepeakOptions {
  narrator?: string;
  speed?: number;
  pitch?: number;
  emotion?: VoicepeakEmotion;
}

const VOICEPEAK_COOLDOWN_MS = 200;
const VOICEPEAK_MAX_RETRIES = 2;

export class VoicepeakClient {
  private static instance: VoicepeakClient;
  private serverUrl: string;
  private defaultNarrator: string;
  private lastCallTime = 0;

  private constructor() {
    this.serverUrl = config.voicepeak.serverUrl;
    this.defaultNarrator = config.voicepeak.narrator;
  }

  public static getInstance(): VoicepeakClient {
    if (!VoicepeakClient.instance) {
      VoicepeakClient.instance = new VoicepeakClient();
    }
    return VoicepeakClient.instance;
  }

  /**
   * PlutchikベースのEmotionStateをVOICEPEAKの4感情にマッピング
   */
  public mapPlutchikToVoicepeak(emotions: Record<string, number>): VoicepeakEmotion {
    const happy = Math.min(100, Math.round(
      (emotions.joy ?? 0) * 1.0 + (emotions.trust ?? 0) * 0.3
    ));
    const fun = Math.min(100, Math.round(
      (emotions.anticipation ?? 0) * 0.8 + (emotions.surprise ?? 0) * 0.5
    ));
    const angry = Math.min(100, Math.round(
      (emotions.anger ?? 0) * 1.0 + (emotions.disgust ?? 0) * 0.4
    ));
    const sad = Math.min(100, Math.round(
      (emotions.sadness ?? 0) * 1.0 + (emotions.fear ?? 0) * 0.4
    ));
    return { happy, fun, angry, sad };
  }

  /**
   * テキストからWAV音声を生成
   * @returns WAVバイナリのBuffer
   */
  async synthesize(text: string, options?: VoicepeakOptions): Promise<Buffer> {
    const body = {
      text,
      narrator: options?.narrator ?? this.defaultNarrator,
      speed: options?.speed ?? 100,
      pitch: options?.pitch ?? 0,
      emotion: options?.emotion,
    };

    logger.info(`[VOICEPEAK] Synthesizing: "${text.substring(0, 50)}..."`, 'cyan');

    // Enforce cooldown between calls to prevent CLI instance collision
    const elapsed = Date.now() - this.lastCallTime;
    if (elapsed < VOICEPEAK_COOLDOWN_MS) {
      await new Promise(r => setTimeout(r, VOICEPEAK_COOLDOWN_MS - elapsed));
    }

    for (let attempt = 0; attempt <= VOICEPEAK_MAX_RETRIES; attempt++) {
      try {
        this.lastCallTime = Date.now();
        const response = await axios.post(`${this.serverUrl}/tts`, body, {
          responseType: 'arraybuffer',
          timeout: 30000,
          headers: { 'Content-Type': 'application/json' },
        });

        const wavBuffer = Buffer.from(response.data);
        logger.info(`[VOICEPEAK] Generated ${wavBuffer.length} bytes`, 'green');
        return wavBuffer;
      } catch (error) {
        const is500 = axios.isAxiosError(error) && error.response?.status === 500;
        if (is500 && attempt < VOICEPEAK_MAX_RETRIES) {
          const wait = VOICEPEAK_COOLDOWN_MS * (attempt + 2);
          logger.warn(`[VOICEPEAK] Instance busy, retry ${attempt + 1}/${VOICEPEAK_MAX_RETRIES} after ${wait}ms`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        if (axios.isAxiosError(error)) {
          const detail = error.response
            ? `status=${error.response.status} ${Buffer.from(error.response.data).toString()}`
            : error.message;
          logger.error(`[VOICEPEAK] TTS request failed: ${detail}`);
        } else {
          logger.error(`[VOICEPEAK] TTS request failed: ${error}`);
        }
        throw error;
      }
    }
    throw new Error('[VOICEPEAK] Unreachable');
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await axios.get(`${this.serverUrl}/health`, { timeout: 5000 });
      return res.status === 200;
    } catch {
      return false;
    }
  }
}

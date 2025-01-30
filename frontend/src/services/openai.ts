import { WS_URL } from '@/services/apiTypes';
import { WebMessageOutput } from '@/types/types';
import { isWebMessageOutput } from '@/types/checkTypes';
export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';

export class OpenAIService {
  private static instance: OpenAIService;
  private ws: WebSocket | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 3000;
  public textCallback: ((text: string) => void) | null = null;
  public textDoneCallback: (() => void) | null = null;
  public audioCallback: ((data: string) => void) | null = null;
  public audioDoneCallback: (() => void) | null = null;
  public userTranscriptCallback: ((text: string) => void) | null = null;
  private statusListeners: Set<(status: ConnectionStatus) => void> = new Set();
  private status: ConnectionStatus = 'disconnected';

  private constructor() {
    this.initialize();
  }

  public static getInstance(): OpenAIService {
    if (!OpenAIService.instance) {
      OpenAIService.instance = new OpenAIService();
    }
    return OpenAIService.instance;
  }

  private async connect() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.setStatus('connecting');
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        console.log('OpenAI WebSocket connected');
        this.setStatus('connected');
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data) as WebMessageOutput;

        if (!isWebMessageOutput(data)) {
          console.error('Invalid message format:', data);
          return;
        }

        if (data.type === 'endpoint' && data.endpoint === 'text_done') {
          this.textDoneCallback?.();
        } else if (data.type === 'endpoint' && data.endpoint === 'audio_done') {
          this.audioDoneCallback?.();
        } else if (data.type === 'text' && data.text) {
          this.textCallback?.(data.text);
        } else if (data.type === 'realtime_text' && data.realtime_text) {
          this.textCallback?.(data.realtime_text);
        } else if (data.type === 'realtime_audio' && data.realtime_audio) {
          console.log(
            `Received audio data: ${data.realtime_audio.length} bytes`
          );
          this.audioCallback?.(data.realtime_audio);
        } else if (data.type === 'user_transcript' && data.realtime_text) {
          this.userTranscriptCallback?.(data.realtime_text);
        }
      };

      this.ws.onclose = () => {
        console.log('OpenAI WebSocket closed');
        this.setStatus('disconnected');
        this.reconnect();
      };

      this.ws.onerror = (error) => {
        console.error('OpenAI WebSocket error:', error);
        this.setStatus('disconnected');
      };
    }
  }

  private reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(
      `Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
    );

    setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
  }

  async initialize() {
    await this.connect();
  }

  private async ensureConnection() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('WebSocket not connected, attempting to reconnect...');
      await this.connect();
    }
  }

  async sendMessage(message: string, isRealTimeChat: boolean) {
    try {
      await this.ensureConnection();

      let messageData: string;
      if (isRealTimeChat) {
        messageData = JSON.stringify({
          type: 'realtime_text',
          realtime_text: message,
        });
      } else {
        messageData = JSON.stringify({
          type: 'text',
          text: message,
        });
      }

      console.log('\x1b[32msendMessage\x1b[0m', messageData);
      this.ws?.send(messageData);
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  async sendVoiceData(data: Blob) {
    try {
      await this.ensureConnection();

      const arrayBuffer = await data.arrayBuffer();
      const base64String = btoa(
        String.fromCharCode(...new Uint8Array(arrayBuffer))
      );
      const messageData = JSON.stringify({
        type: 'realtime_audio',
        realtime_audio: base64String,
      });
      console.log('\x1b[32msendVoiceData\x1b[0m', base64String.length);
      this.ws?.send(messageData);
    } catch (error) {
      console.error('Error sending voice data:', error);
      throw error;
    }
  }

  async commitAudioBuffer() {
    try {
      await this.ensureConnection();

      const messageData = JSON.stringify({
        type: 'realtime_audio',
        endpoint: 'realtime_audio_commit',
      });
      console.log('\x1b[32mcommitAudioBuffer\x1b[0m');
      this.ws?.send(messageData);
    } catch (error) {
      console.error('Error committing audio buffer:', error);
      throw error;
    }
  }

  async vadModeChange(data: boolean) {
    try {
      await this.ensureConnection();

      const messageData = JSON.stringify({
        type: 'endpoint',
        endpoint: data ? 'realtime_vad_on' : 'realtime_vad_off',
      });
      console.log('\x1b[32mvadModeChange\x1b[0m', messageData);
      this.ws?.send(messageData);
    } catch (error) {
      console.error('Error changing VAD mode:', error);
      throw error;
    }
  }

  public onStatusChange(callback: (status: ConnectionStatus) => void) {
    this.statusListeners.add(callback);
    callback(this.status);
    return () => this.statusListeners.delete(callback);
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status));
  }
}

export default OpenAIService.getInstance;

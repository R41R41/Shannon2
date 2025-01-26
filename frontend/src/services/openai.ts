import { WS_URL } from '@/services/apiTypes';

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
        const data = JSON.parse(event.data);
        if (data.type === 'text_done') {
          this.textDoneCallback?.();
        } else if (data.type === 'audio_done') {
          this.audioDoneCallback?.();
        } else if (data.type === 'text') {
          console.log('textCallback', data.content);
          this.textCallback?.(data.content);
        } else if (data.type === 'audio') {
          if (!data.content.length) return;
          console.log(`Received audio data: ${data.content.length} bytes`);
          this.audioCallback?.(data.content);
        } else if (data.type === 'user_transcript') {
          this.userTranscriptCallback?.(data.content);
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

  async sendMessage(message: string) {
    try {
      await this.ensureConnection();

      const messageData = JSON.stringify({
        type: 'text',
        content: message,
      });

      console.log('\x1b[32msendMessage\x1b[0m', message);
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
        type: 'voice_append',
        content: base64String,
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
        type: 'voice_commit',
      });
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
        type: 'vad_change',
        content: data.toString(),
      });
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

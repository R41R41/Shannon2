import WebSocket from 'ws';
import { EventBus } from '../eventBus';
import { Platform, ConversationType } from './types';

export class RealtimeAPIService {
  private ws: WebSocket | null = null;
  private eventBus: EventBus;
  private initialized: boolean = false;
  public onTextResponse: ((text: string) => void) | null;
  public onTextDoneResponse: (() => void) | null;
  public onAudioResponse: ((audio: Uint8Array) => void) | null;
  public onAudioDoneResponse: (() => void) | null;
  public onUserTranscriptResponse: ((text: string) => void) | null = null;
  private callbackTextQueue: string[] = [];
  private callbackAudioQueue: Uint8Array[] = [];
  private isProcessingTextQueue: boolean = false;
  private isProcessingAudioQueue: boolean = false;
  private responseAudioBuffer: Uint8Array = new Uint8Array(0);
  private isTextResponseComplete: boolean = false;
  private isAudioResponseComplete: boolean = false;
  private isUserTranscriptResponseComplete: boolean = true;
  private isVadMode: boolean = false;
  private noVadSessionConfig: any;
  private vadSessionConfig: any;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 5000; // 5秒

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.initialized = false; // 初期化状態を追跡
    this.onTextResponse = null; // テキストレスポンス用コールバック
    this.onTextDoneResponse = null; // テキスト完了用コールバック
    this.onAudioResponse = null; // 音声レスポンス用コールバック
    this.onAudioDoneResponse = null; // 音声完了用コールバック
    this.onUserTranscriptResponse = null; // ユーザー音声レスポンス用コールバック
    this.responseAudioBuffer = new Uint8Array(0);
    this.initialize();
    this.noVadSessionConfig = {
      type: 'session.update',
      session: {
        turn_detection: null,
        modalities: ['text', 'audio'],
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'whisper-1' },
        instructions:
          'あなたは優秀なアシスタントAI「シャノン」です。敬語を使って日本語で丁寧に簡潔に答えてください。',
        tool_choice: 'none', // オプション：function callingを使用する場合に必要
        voice: 'sage', // 利用可能なオプション: alloy, ash, ballad, coral, echo, sage, shimmer, verse
        temperature: 0.8, // 0.6 から 1.2 の間
        tools: [],
      },
    };
    this.vadSessionConfig = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad' },
        modalities: ['text', 'audio'],
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'whisper-1' },
        instructions:
          'あなたは優秀なアシスタントAI「シャノン」です。敬語を使って日本語で丁寧に簡潔に答えてください。',
        tool_choice: 'none', // オプション：function callingを使用する場合に必要
        voice: 'sage', // 利用可能なオプション: alloy, ash, ballad, coral, echo, sage, shimmer, verse
        temperature: 0.8, // 0.6 から 1.2 の間
        tools: [],
      },
    };
  }

  setTextCallback(callback: (text: string) => void) {
    this.onTextResponse = (text: string) => {
      this.callbackTextQueue.push(text);
      this.processTextQueue(callback);
    };
  }

  setUserTranscriptCallback(callback: (text: string) => void) {
    this.onUserTranscriptResponse = callback;
  }

  setAudioCallback(callback: (audio: Uint8Array) => void) {
    this.onAudioResponse = (audio: Uint8Array) => {
      this.callbackAudioQueue.push(audio);
      this.processAudioQueue(callback);
    };
  }

  private processTextQueue(callback: (text: string) => void) {
    if (this.isProcessingTextQueue) return;
    if (!this.isUserTranscriptResponseComplete) return;
    this.isProcessingTextQueue = true;

    const processNext = () => {
      if (!this.isUserTranscriptResponseComplete) {
        this.isProcessingTextQueue = false;
        return;
      }

      if (this.callbackTextQueue.length > 0) {
        const text = this.callbackTextQueue.shift();
        if (text) {
          callback(text);
        }
        setTimeout(processNext, 50);
      } else {
        this.isProcessingTextQueue = false;
        if (this.isTextResponseComplete && this.onTextDoneResponse) {
          this.onTextDoneResponse();
          this.isTextResponseComplete = false;
        }
      }
    };

    processNext();
  }

  private processAudioQueue(callback: (audio: Uint8Array) => void) {
    if (this.isProcessingAudioQueue) return;
    this.isProcessingAudioQueue = true;

    const processNext = () => {
      if (this.callbackAudioQueue.length > 0) {
        const audio = this.callbackAudioQueue.shift();
        if (audio) {
          callback(audio);
        }
        setTimeout(processNext, 10);
      } else {
        this.isProcessingAudioQueue = false;
        if (this.isAudioResponseComplete && this.onAudioDoneResponse) {
          this.onAudioDoneResponse();
          this.isAudioResponseComplete = false;
        }
      }
    };

    processNext();
  }

  setTextDoneCallback(callback: () => void) {
    this.callbackTextQueue = [];
    this.onTextDoneResponse = callback;
  }

  setAudioDoneCallback(callback: () => void) {
    this.callbackAudioQueue = [];
    this.onAudioDoneResponse = callback;
  }

  private async initialize() {
    if (this.initialized) return;
    console.log('\x1b[36mRealtimeAPI initialized\x1b[0m');

    const url =
      'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      this.ws.on('open', () => {
        console.log('\x1b[32mConnected to OpenAI Realtime API\x1b[0m');
        // セッション設定を送信
        if (this.ws) {
          this.ws.send(JSON.stringify(this.noVadSessionConfig));
        }
        this.initialized = true;
        resolve(true);
      });

      this.ws.on('message', (message: WebSocket.Data) => {
        const data = JSON.parse(message.toString());

        switch (data.type) {
          case 'session.created':
            console.log('\x1b[34mSession created\x1b[0m');
            this.eventBus.log('web', 'blue', 'Session created');
            break;

          case 'session.updated':
            console.log('\x1b[36mSession updated\x1b[0m');
            this.eventBus.log('web', 'cyan', 'Session updated');
            break;

          case 'response.created':
            console.log('\x1b[34mResponse creation started\x1b[0m');
            this.eventBus.log('web', 'blue', 'Response creation started');
            break;

          case 'response.text.delta':
            if (this.onTextResponse) {
              this.onTextResponse(data.delta);
            }
            break;

          case 'response.text.done':
            console.log('\x1b[32mText done\x1b[0m');
            this.eventBus.log('web', 'green', 'Text done');
            this.isTextResponseComplete = true;
            if (!this.isProcessingTextQueue && this.onTextDoneResponse) {
              this.onTextDoneResponse();
              this.isTextResponseComplete = false;
            }
            break;

          case 'input_audio_buffer.committed':
            console.log('\x1b[32mSpeech committed\x1b[0m');
            this.eventBus.log('web', 'green', 'Speech committed');
            this.isUserTranscriptResponseComplete = false;
            break;

          case 'input_audio_buffer.append':
            // console.log(
            // 	"\x1b[32minput_audio_buffer.append\x1b[0m",
            // 	data.audio.length
            // );
            break;

          case 'input_audio_buffer.debug':
            console.log(
              `\x1b[33mCurrent OpenAI buffer state: ${JSON.stringify(
                data,
                null,
                2
              )}\x1b[0m`
            );
            break;

          case 'response.audio.delta':
            if (this.onAudioResponse) {
              this.onAudioResponse(data.delta);
            }
            break;

          case 'response.audio.done':
            console.log(
              `\x1b[32mResponse Audio completed: ${this.responseAudioBuffer.length} bytes\x1b[0m`
            );
            this.eventBus.log('web', 'green', 'Response Audio completed');
            this.isAudioResponseComplete = true;
            if (!this.isProcessingAudioQueue && this.onAudioDoneResponse) {
              this.onAudioDoneResponse();
              this.isAudioResponseComplete = false;
            }
            break;

          case 'response.audio_transcript.delta':
            if (this.onTextResponse) {
              this.onTextResponse(data.delta);
            }
            break;

          case 'response.audio_transcript.done':
            console.log('\x1b[32mTranscript done\x1b[0m');
            this.eventBus.log('web', 'green', 'Transcript done');
            this.isTextResponseComplete = true;
            if (!this.isProcessingTextQueue && this.onTextDoneResponse) {
              this.onTextDoneResponse();
              this.isTextResponseComplete = false;
            }
            break;

          case 'conversation.item.input_audio_transcription.completed':
            console.log('\x1b[32mTranscript completed\x1b[0m');
            this.eventBus.log('web', 'green', 'Transcript completed');
            this.isUserTranscriptResponseComplete = true;
            if (this.onUserTranscriptResponse && data.transcript) {
              this.onUserTranscriptResponse(data.transcript);
            }
            break;

          case 'error':
            console.error(
              `\x1b[31mServer error: ${JSON.stringify(data)}\x1b[0m`
            );
            this.eventBus.log('web', 'red', 'Server error', true);
            break;

          default:
            console.info(`\x1b[37mUnhandled event type: ${data.type}\x1b[0m`);
            this.eventBus.log(
              'web',
              'white',
              'Unhandled event type: ' + data.type
            );
            break;
        }
      });

      this.ws.on('error', (error) => {
        console.error(`\x1b[31mWebSocket error: ${error}\x1b[0m`);
        this.eventBus.log('web', 'red', 'WebSocket error');
        reject(error);
      });

      this.ws.on('close', () => {
        console.log('\x1b[31mWebSocket connection closed\x1b[0m');
        this.eventBus.log('web', 'red', 'WebSocket connection closed');
        this.initialized = false;
      });
    });
  }

  private async ensureConnection() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('WebSocket not connected, attempting to reconnect...');
      await this.initialize();
    }
  }

  async inputText(text: string) {
    try {
      await this.ensureConnection();

      const textMessage = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }],
        },
      };
      this.ws?.send(JSON.stringify(textMessage));

      const responseRequest = {
        type: 'response.create',
        response: { modalities: ['text'] },
      };
      this.ws?.send(JSON.stringify(responseRequest));
    } catch (error) {
      console.error('Error processing text input:', error);
      throw error;
    }
  }

  async inputAudioBufferAppend(data: string) {
    try {
      await this.ensureConnection();

      const audioMessage = {
        type: 'input_audio_buffer.append',
        audio: data,
      };
      this.ws?.send(JSON.stringify(audioMessage));
    } catch (error) {
      console.error(`\x1b[31mError processing voice input: ${error}\x1b[0m`);
      throw error;
    }
  }

  async inputAudioBufferCommit() {
    if (this.ws) {
      const commitMessage = {
        type: 'input_audio_buffer.commit',
      };
      this.ws.send(JSON.stringify(commitMessage));

      const responseRequest = {
        type: 'response.create',
        response: {
          modalities: ['audio', 'text'],
        },
      };
      this.ws.send(JSON.stringify(responseRequest));
    }
  }

  async vadModeChange(data: string) {
    if (this.ws) {
      this.isVadMode = data === 'true';
      if (this.isVadMode) {
        console.log('\x1b[36mVAD mode change: true\x1b[0m');
        this.eventBus.log('web', 'cyan', 'VAD mode change: true');
        this.ws.send(JSON.stringify(this.vadSessionConfig));
      } else {
        console.log('\x1b[36mVAD mode change: false\x1b[0m');
        this.eventBus.log('web', 'cyan', 'VAD mode change: false');
        this.ws.send(JSON.stringify(this.noVadSessionConfig));
      }
    }
  }

  cleanup() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private async connect() {
    try {
      const url =
        'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';

      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      this.ws.onclose = this.handleDisconnect.bind(this);
      this.setupWebSocketHandlers();

      // セッション設定を送信
      await this.initializeSession();

      this.reconnectAttempts = 0; // 接続成功したらリセット
      this.eventBus.log('web', 'white', 'Connected to OpenAI Realtime API');
    } catch (error) {
      this.eventBus.log('web', 'red', JSON.stringify(error), true);
      this.handleDisconnect();
    }
  }

  private handleDisconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.eventBus.log(
        'web',
        'white',
        `Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts}`
      );

      setTimeout(() => {
        this.connect();
      }, this.reconnectDelay);
    } else {
      this.eventBus.log('web', 'red', 'Max reconnection attempts reached');
    }
  }

  private async initializeSession() {
    if (!this.ws) return;

    // 基本的なセッション設定
    const sessionConfig = {
      type: 'session.update',
      session: {
        turn_detection: null,
        modalities: ['text', 'audio'],
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'whisper-1' },
        instructions:
          'あなたは優秀なアシスタントAI「シャノン」です。敬語を使って日本語で丁寧に簡潔に答えてください。',
        voice: 'sage',
        temperature: 0.8,
      },
    };

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject('No WebSocket connection');

      const timeout = setTimeout(() => {
        reject('Session initialization timeout');
      }, 10000);

      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data.toString());
        if (data.type === 'session.created') {
          clearTimeout(timeout);
          resolve();
        }
      };

      this.ws.send(JSON.stringify(sessionConfig));
    });
  }

  private setupWebSocketHandlers() {
    // Implementation of setupWebSocketHandlers method
  }
}

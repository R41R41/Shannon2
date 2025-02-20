import {
  OpenAIMessageOutput,
  OpenAITextInput,
  OpenAIRealTimeTextInput,
  OpenAIRealTimeAudioInput,
  OpenAICommandInput,
} from '@shannon/common';
import {
  WebSocketServiceBase,
  WebSocketServiceConfig,
} from '../../common/WebSocketService.js';
export class OpenAIClientService extends WebSocketServiceBase {
  constructor(config: WebSocketServiceConfig) {
    super(config);
  }

  protected initialize() {
    this.wss.on('connection', (ws) => {
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());

          if (data.type === 'ping') {
            this.broadcast({ type: 'pong' } as OpenAIMessageOutput);
            return;
          }
          console.log(
            `\x1b[34mvalid web message received in openai agent: ${
              data.type === 'realtime_audio'
                ? data.type + ' ' + data.realtime_audio?.length
                : data.type === 'audio'
                ? data.type + ' ' + data.audio?.length
                : JSON.stringify(data)
            }\x1b[0m`
          );
          if (data.type === 'realtime_text' && data.realtime_text) {
            this.eventBus.log('web', 'white', data.realtime_text);
            const message: OpenAIRealTimeTextInput = {
              type: 'realtime_text',
              realtime_text: data.realtime_text,
            };

            this.eventBus.publish({
              type: 'llm:get_web_message',
              memoryZone: 'web',
              data: message,
            });
          } else if (data.type === 'text' && data.text && data.recentChatLog) {
            this.eventBus.log('web', 'white', data.text, true);
            const message: OpenAITextInput = {
              type: 'text',
              text: data.text,
              recentChatLog: data.recentChatLog,
            };
            this.eventBus.publish({
              type: 'llm:get_web_message',
              memoryZone: 'web',
              data: message,
            });
          } else if (data.type === 'realtime_audio' && data.realtime_audio) {
            const message: OpenAIRealTimeAudioInput = {
              type: 'realtime_audio',
              realtime_audio: data.realtime_audio,
              command: 'realtime_audio_append',
            };

            this.eventBus.publish({
              type: 'llm:get_web_message',
              memoryZone: 'web',
              data: message,
            });
          } else if (
            data.type === 'realtime_audio' &&
            data.command === 'realtime_audio_commit'
          ) {
            const message: OpenAICommandInput = {
              type: 'command',
              command: 'realtime_audio_commit',
            };

            this.eventBus.publish({
              type: 'llm:get_web_message',
              memoryZone: 'web',
              data: message,
            });
          } else if (data.type === 'command' && data.command) {
            this.eventBus.log(
              'web',
              'white',
              'received realtime voice commit',
              true
            );
            const message: OpenAICommandInput = {
              type: 'command',
              command: data.command,
            };

            this.eventBus.publish({
              type: 'llm:get_web_message',
              memoryZone: 'web',
              data: message,
            });
          } else if (data.command === 'realtime_vad_on') {
            this.eventBus.log('web', 'white', 'received realtime vad on');
            const message: OpenAICommandInput = {
              type: 'command',
              command: data.command,
            };

            this.eventBus.publish({
              type: 'llm:get_web_message',
              memoryZone: 'web',
              data: message,
            });
          } else if (data.command === 'realtime_vad_off') {
            this.eventBus.log('web', 'white', 'received realtime vad off');
            const message: OpenAICommandInput = {
              type: 'command',
              command: data.command,
            };

            this.eventBus.publish({
              type: 'llm:get_web_message',
              memoryZone: 'web',
              data: message,
            });
          }
        } catch (error) {
          this.eventBus.log(
            'web',
            'red',
            'Error processing message:' + error,
            true
          );
          console.error('Error processing message:', error);
        }
      });

      this.eventBus.subscribe('web:post_message', (event) => {
        const data = event.data as OpenAITextInput;
        this.eventBus.log('web', 'white', data.text);
        if (event.memoryZone === 'web') {
          ws.send(JSON.stringify(event.data));
        }
      });
    });
  }

  public start() {
    this.initialize();
  }
}

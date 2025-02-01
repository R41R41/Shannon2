import { isOpenAIMessageInput } from '@common/checkTypes';
import { OpenAIMessageInput, OpenAIMessageOutput } from '@common/types';
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
          if (isOpenAIMessageInput(data)) {
            if (data.type === 'ping') {
              this.broadcast({ type: 'pong' } as OpenAIMessageOutput);
              return;
            }
            console.log(
              `\x1b[34mvalid web message received: ${
                data.type === 'realtime_audio'
                  ? data.type + ' ' + data.realtime_audio?.length
                  : data.type === 'audio'
                  ? data.type + ' ' + data.audio?.length
                  : JSON.stringify(data)
              }\x1b[0m`
            );
          } else {
            throw new Error('Invalid message format');
          }
          if (data.type === 'realtime_text' && data.realtime_text) {
            this.eventBus.log('web', 'white', data.realtime_text);
            const message: OpenAIMessageInput = {
              type: 'realtime_text',
              realtime_text: data.realtime_text,
            };

            this.eventBus.publish({
              type: 'web:get_message',
              memoryZone: 'web',
              data: message,
            });
          } else if (data.type === 'text' && data.text) {
            this.eventBus.log('web', 'white', data.text, true);
            const message: OpenAIMessageInput = {
              type: 'text',
              text: data.text,
            };
            this.eventBus.publish({
              type: 'web:get_message',
              memoryZone: 'web',
              data: message,
            });
          } else if (data.type === 'realtime_audio' && data.realtime_audio) {
            const message: OpenAIMessageInput = {
              type: 'realtime_audio',
              realtime_audio: data.realtime_audio,
              endpoint: 'realtime_audio_append',
            };

            this.eventBus.publish({
              type: 'web:get_message',
              memoryZone: 'web',
              data: message,
            });
          } else if (
            data.type === 'realtime_audio' &&
            data.endpoint === 'realtime_audio_commit'
          ) {
            const message: OpenAIMessageInput = {
              type: 'realtime_audio',
              endpoint: 'realtime_audio_commit',
            };

            this.eventBus.publish({
              type: 'web:get_message',
              memoryZone: 'web',
              data: message,
            });
          } else if (data.type === 'endpoint' && data.endpoint) {
            this.eventBus.log(
              'web',
              'white',
              'received realtime voice commit',
              true
            );
            const message: OpenAIMessageInput = {
              type: 'endpoint',
              endpoint: data.endpoint,
            };

            this.eventBus.publish({
              type: 'web:get_message',
              memoryZone: 'web',
              data: message,
            });
          } else if (data.endpoint === 'realtime_vad_on') {
            this.eventBus.log('web', 'white', 'received realtime vad on');
            const message: OpenAIMessageInput = {
              type: 'endpoint',
              endpoint: data.endpoint,
            };

            this.eventBus.publish({
              type: 'web:get_message',
              memoryZone: 'web',
              data: message,
            });
          } else if (data.endpoint === 'realtime_vad_off') {
            this.eventBus.log('web', 'white', 'received realtime vad off');
            const message: OpenAIMessageInput = {
              type: 'endpoint',
              endpoint: data.endpoint,
            };

            this.eventBus.publish({
              type: 'web:get_message',
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

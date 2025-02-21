import {
  EventType,
  ServiceCommand,
  ServiceInput,
  StatusAgentInput,
  StatusAgentOutput,
} from '@shannon/common';
import {
  WebSocketServiceBase,
  WebSocketServiceConfig,
} from '../../common/WebSocketService.js';

export class StatusAgent extends WebSocketServiceBase {
  private static instance: StatusAgent;
  private constructor(config: WebSocketServiceConfig) {
    super(config);
  }

  public static getInstance(config: WebSocketServiceConfig): StatusAgent {
    if (!StatusAgent.instance) {
      StatusAgent.instance = new StatusAgent(config);
    }
    return StatusAgent.instance;
  }

  protected override initialize() {
    if (this.wss) {
      this.wss.clients.forEach((client) => {
        client.close();
      });
    }

    this.wss.on('connection', (ws) => {
      console.log('\x1b[34mStatus client connected\x1b[0m');

      ws.on('close', () => {
        console.log('\x1b[31mStatus client disconnected\x1b[0m');
      });

      ws.on('message', async (message) => {
        const data = JSON.parse(message.toString());
        if (data.type === 'service:command') {
          const service = data.service;
          const command = data.command;
          const serverName = data.serverName ? data.serverName : null;
          this.eventBus.publish({
            type: `${service}:status` as EventType,
            memoryZone: 'web',
            data: {
              serviceCommand: command as ServiceCommand,
              serverName,
            } as ServiceInput,
          });
        }
      });
      this.eventBus.subscribe('web:status', (event) => {
        const status = event.data as StatusAgentInput;
        ws.send(
          JSON.stringify({
            type: 'service:status',
            service: status.service,
            data: status.status,
          } as StatusAgentOutput)
        );
      });
    });
  }
}

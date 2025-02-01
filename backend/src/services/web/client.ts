import { PORTS } from '../../config/ports.js';
import { EventBus } from '../eventBus.js';
import { MonitoringAgent } from './agents/monitoringAgent.js';
import { OpenAIClientService } from './agents/openaiAgent.js';

export class WebClient {
  private openaiService: OpenAIClientService;
  private monitoringService: MonitoringAgent;

  constructor(eventBus: EventBus) {
    this.openaiService = new OpenAIClientService({
      port: PORTS.WEBSOCKET.OPENAI as number,
      eventBus: eventBus,
      serviceName: 'openai',
    });

    this.monitoringService = new MonitoringAgent({
      port: PORTS.WEBSOCKET.MONITORING as number,
      eventBus: eventBus,
      serviceName: 'monitoring',
    });
  }

  public start() {
    this.openaiService.start();
    this.monitoringService.start();
  }
}

import { PORTS } from '../../config/ports.js';
import { EventBus } from '../eventBus.js';
import { MonitoringAgent } from './agents/monitoringAgent.js';
import { OpenAIClientService } from './agents/openaiAgent.js';
import { ScheduleAgent } from './agents/scheduleAgent.js';
import { StatusAgent } from './agents/statusAgent.js';
export class WebClient {
  private openaiService: OpenAIClientService;
  private monitoringService: MonitoringAgent;
  private scheduleService: ScheduleAgent;
  private statusService: StatusAgent;
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

    this.statusService = new StatusAgent({
      port: PORTS.WEBSOCKET.STATUS as number,
      eventBus: eventBus,
      serviceName: 'status',
    });

    this.scheduleService = new ScheduleAgent({
      port: PORTS.WEBSOCKET.SCHEDULE as number,
      eventBus: eventBus,
      serviceName: 'schedule',
    });
  }

  public start() {
    this.openaiService.start();
    this.monitoringService.start();
    this.statusService.start();
    this.scheduleService.start();
  }
}

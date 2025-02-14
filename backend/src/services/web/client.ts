import { PORTS } from '../../config/ports.js';
import { MonitoringAgent } from './agents/monitoringAgent.js';
import { OpenAIClientService } from './agents/openaiAgent.js';
import { ScheduleAgent } from './agents/scheduleAgent.js';
import { StatusAgent } from './agents/statusAgent.js';
import { getEventBus } from '../eventBus/index.js';

export class WebClient {
  private openaiService: OpenAIClientService;
  private monitoringService: MonitoringAgent;
  private scheduleService: ScheduleAgent;
  private statusService: StatusAgent;
  constructor(isTest: boolean) {
    const eventBus = getEventBus();
    this.openaiService = new OpenAIClientService({
      port: isTest
        ? Number(PORTS.WEBSOCKET.OPENAI) + 10000
        : Number(PORTS.WEBSOCKET.OPENAI),
      eventBus: eventBus,
      serviceName: 'openai',
    });

    this.monitoringService = new MonitoringAgent({
      port: isTest
        ? Number(PORTS.WEBSOCKET.MONITORING) + 10000
        : Number(PORTS.WEBSOCKET.MONITORING),
      eventBus: eventBus,
      serviceName: 'monitoring',
    });

    this.statusService = new StatusAgent({
      port: isTest
        ? Number(PORTS.WEBSOCKET.STATUS) + 10000
        : Number(PORTS.WEBSOCKET.STATUS),
      eventBus: eventBus,
      serviceName: 'status',
    });

    this.scheduleService = ScheduleAgent.getInstance({
      port: isTest
        ? Number(PORTS.WEBSOCKET.SCHEDULE) + 10000
        : Number(PORTS.WEBSOCKET.SCHEDULE),
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

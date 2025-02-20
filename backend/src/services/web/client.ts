import { PORTS } from '../../config/ports.js';
import { MonitoringAgent } from './agents/monitoringAgent.js';
import { OpenAIClientService } from './agents/openaiAgent.js';
import { ScheduleAgent } from './agents/scheduleAgent.js';
import { StatusAgent } from './agents/statusAgent.js';
import { getEventBus } from '../eventBus/index.js';
import { PlanningAgent } from './agents/planningAgent.js';
import { EmotionAgent } from './agents/emotionAgent.js';

export class WebClient {
  private openaiService: OpenAIClientService;
  private monitoringService: MonitoringAgent;
  private scheduleService: ScheduleAgent;
  private statusService: StatusAgent;
  private planningService: PlanningAgent;
  private emotionService: EmotionAgent;
  constructor(isTest: boolean) {
    const eventBus = getEventBus();
    this.openaiService = OpenAIClientService.getInstance({
      port: isTest
        ? Number(PORTS.WEBSOCKET.OPENAI) + 10000
        : Number(PORTS.WEBSOCKET.OPENAI),
      eventBus: eventBus,
      serviceName: 'openai',
    });

    this.monitoringService = MonitoringAgent.getInstance({
      port: isTest
        ? Number(PORTS.WEBSOCKET.MONITORING) + 10000
        : Number(PORTS.WEBSOCKET.MONITORING),
      eventBus: eventBus,
      serviceName: 'monitoring',
    });

    this.statusService = StatusAgent.getInstance({
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

    this.planningService = PlanningAgent.getInstance({
      port: isTest
        ? Number(PORTS.WEBSOCKET.PLANNING) + 10000
        : Number(PORTS.WEBSOCKET.PLANNING),
      eventBus: eventBus,
      serviceName: 'planning',
    });

    this.emotionService = EmotionAgent.getInstance({
      port: isTest
        ? Number(PORTS.WEBSOCKET.EMOTION) + 10000
        : Number(PORTS.WEBSOCKET.EMOTION),
      eventBus: eventBus,
      serviceName: 'emotion',
    });
  }

  public start() {
    this.openaiService.start();
    this.monitoringService.start();
    this.statusService.start();
    this.scheduleService.start();
    this.planningService.start();
    this.emotionService.start();
  }
}

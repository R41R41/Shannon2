import { MonitoringAgent } from './agents/monitoringAgent';
import { OpenAIAgent } from './agents/openaiAgent';
import { SchedulerAgent } from './agents/schedulerAgent';
import { StatusAgent } from './agents/statusAgent';

export class WebClient {
  public openaiService: OpenAIAgent;
  public monitoringService: MonitoringAgent;
  public schedulerService: SchedulerAgent;
  public statusService: StatusAgent;
  constructor() {
    this.openaiService = OpenAIAgent.getInstance();
    this.monitoringService = MonitoringAgent.getInstance();
    this.schedulerService = SchedulerAgent.getInstance();
    this.statusService = StatusAgent.getInstance();
  }

  public start() {
    this.openaiService.connect();
    this.monitoringService.connect();
    this.schedulerService.connect();
    this.statusService.connect();
  }
}

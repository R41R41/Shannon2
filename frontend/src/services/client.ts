import { MonitoringAgent } from './agents/monitoringAgent';
import { OpenAIAgent } from './agents/openaiAgent';
import { SchedulerAgent } from './agents/schedulerAgent';
export class WebClient {
  public openaiService: OpenAIAgent;
  public monitoringService: MonitoringAgent;
  public schedulerService: SchedulerAgent;
  constructor() {
    this.openaiService = OpenAIAgent.getInstance();
    this.monitoringService = MonitoringAgent.getInstance();
    this.schedulerService = SchedulerAgent.getInstance();
  }

  public start() {
    this.openaiService.connect();
    this.monitoringService.connect();
    this.schedulerService.connect();
  }
}

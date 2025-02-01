import { MonitoringAgent } from './agents/monitoringAgent';
import { OpenAIAgent } from './agents/openaiAgent';

export class WebClient {
  public openaiService: OpenAIAgent;
  public monitoringService: MonitoringAgent;

  constructor() {
    this.openaiService = OpenAIAgent.getInstance();
    this.monitoringService = MonitoringAgent.getInstance();
  }

  public start() {
    this.openaiService.connect();
    this.monitoringService.connect();
  }
}

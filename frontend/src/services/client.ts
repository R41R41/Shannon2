import { MonitoringAgent } from "./agents/monitoringAgent";
import { OpenAIAgent } from "./agents/openaiAgent";
import { SchedulerAgent } from "./agents/schedulerAgent";
import { StatusAgent } from "./agents/statusAgent";
import { PlanningAgent } from "./agents/planningAgent";
import { EmotionAgent } from "./agents/emotionAgent";
import { SkillAgent } from "./agents/skillAgent";
export class WebClient {
  public openaiService: OpenAIAgent;
  public monitoringService: MonitoringAgent;
  public schedulerService: SchedulerAgent;
  public statusService: StatusAgent;
  public planningService: PlanningAgent;
  public emotionService: EmotionAgent;
  public skillService: SkillAgent;
  constructor() {
    this.openaiService = OpenAIAgent.getInstance();
    this.monitoringService = MonitoringAgent.getInstance();
    this.schedulerService = SchedulerAgent.getInstance();
    this.statusService = StatusAgent.getInstance();
    this.planningService = PlanningAgent.getInstance();
    this.emotionService = EmotionAgent.getInstance();
    this.skillService = SkillAgent.getInstance();
  }

  public start() {
    this.openaiService.connect();
    this.monitoringService.connect();
    this.schedulerService.connect();
    this.statusService.connect();
    this.planningService.connect();
    this.emotionService.connect();
    this.skillService.connect();
  }
}

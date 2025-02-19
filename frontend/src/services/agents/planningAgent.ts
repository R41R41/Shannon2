import { TaskTreeState } from "@common/types";
import { WebSocketClientBase } from "../common/WebSocketClient";
import { URLS } from "../config/ports";

type UpdatePlanningCallback = (planning: TaskTreeState) => void;

export class PlanningAgent extends WebSocketClientBase {
  private static instance: PlanningAgent;

  public static getInstance() {
    if (!PlanningAgent.instance) {
      PlanningAgent.instance = new PlanningAgent(URLS.WEBSOCKET.PLANNING);
      console.log("PlanningAgent instance created ", URLS.WEBSOCKET.PLANNING);
    }
    return PlanningAgent.instance;
  }

  public updatePlanningCallback: UpdatePlanningCallback;

  private constructor(url: string) {
    super(url);
    this.updatePlanningCallback = () => {};
  }

  protected handleMessage(message: string) {
    const data = JSON.parse(message);
    if (data.type === "pong") return;
    if (data.type === "web:planning") {
      this.updatePlanningCallback(data.data as TaskTreeState);
    }
  }

  public setUpdatePlanningCallback(callback: UpdatePlanningCallback) {
    this.updatePlanningCallback = callback;
  }

  public onUpdatePlanning(callback: UpdatePlanningCallback) {
    this.updatePlanningCallback = callback;
  }
}

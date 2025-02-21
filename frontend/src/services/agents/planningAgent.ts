import { TaskTreeState } from "@common/types/taskGraph";
import { WebSocketClientBase } from "../common/WebSocketClient";
import { URLS } from "../config/ports";

type UpdatePlanningCallback = (planning: TaskTreeState) => void;

export class PlanningAgent extends WebSocketClientBase {
  private static instance: PlanningAgent;
  private static isConnecting: boolean = false;

  public static getInstance() {
    if (!PlanningAgent.instance) {
      PlanningAgent.instance = new PlanningAgent(URLS.WEBSOCKET.PLANNING);
    }
    return PlanningAgent.instance;
  }

  public updatePlanningCallback: UpdatePlanningCallback;

  private constructor(url: string) {
    super(url);
    this.updatePlanningCallback = () => {};
  }

  public connect() {
    if (PlanningAgent.isConnecting) return;
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return;
    PlanningAgent.isConnecting = true;
    super.connect();
  }

  protected onOpen() {
    super.onOpen();
    PlanningAgent.isConnecting = false;
  }

  protected onClose() {
    super.onClose();
    PlanningAgent.isConnecting = false;
  }

  public disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    PlanningAgent.isConnecting = false;
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

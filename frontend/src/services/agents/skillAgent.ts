import { WebSocketClientBase } from "../common/WebSocketClient";
import { URLS } from "../config/ports";
import { SkillInfo } from "@common/types/llm";

type UpdateSkillsCallback = (skills: SkillInfo[]) => void;

export class SkillAgent extends WebSocketClientBase {
  private static instance: SkillAgent;
  private static isConnecting: boolean = false;

  public static getInstance() {
    if (!SkillAgent.instance) {
      SkillAgent.instance = new SkillAgent(URLS.WEBSOCKET.SKILL);
    }
    return SkillAgent.instance;
  }

  public connect() {
    if (SkillAgent.isConnecting) return;
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return;
    SkillAgent.isConnecting = true;
    super.connect();
  }

  protected onOpen() {
    super.onOpen();
    SkillAgent.isConnecting = false;
  }

  protected onClose() {
    super.onClose();
    SkillAgent.isConnecting = false;
  }

  public disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    SkillAgent.isConnecting = false;
  }

  public updateSkillsCallback: UpdateSkillsCallback;

  private constructor(url: string) {
    super(url);
    this.updateSkillsCallback = () => {};
  }

  protected handleMessage(message: string) {
    const data = JSON.parse(message);
    if (data.type === "pong") return;
    if (data.type === "web:skill") {
      this.updateSkillsCallback(data.data as SkillInfo[]);
    }
  }

  public setUpdateSkillsCallback(callback: UpdateSkillsCallback) {
    this.updateSkillsCallback = callback;
  }

  public async getSkills(): Promise<void> {
    this.send(JSON.stringify({ type: "get_skills" }));
  }

  public onUpdateSkills(callback: UpdateSkillsCallback) {
    this.updateSkillsCallback = callback;
  }
}

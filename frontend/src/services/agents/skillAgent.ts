import { WebSocketClientBase } from "../common/WebSocketClient";
import { URLS } from "../config/ports";
import { SkillInfo } from "@common/types/llm";

type UpdateSkillsCallback = (skills: SkillInfo[]) => void;

export class SkillAgent extends WebSocketClientBase {
  private static instance: SkillAgent;

  public static getInstance() {
    if (!SkillAgent.instance) {
      SkillAgent.instance = new SkillAgent(URLS.WEBSOCKET.SKILL);
      console.log("SkillAgent instance created ", URLS.WEBSOCKET.SKILL);
    }
    return SkillAgent.instance;
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

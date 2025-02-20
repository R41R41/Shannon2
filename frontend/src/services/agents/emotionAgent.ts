import { EmotionType } from "@common/types";
import { WebSocketClientBase } from "../common/WebSocketClient";
import { URLS } from "../config/ports";

type UpdateEmotionCallback = (emotion: EmotionType) => void;

export class EmotionAgent extends WebSocketClientBase {
  private static instance: EmotionAgent;

  public static getInstance() {
    if (!EmotionAgent.instance) {
      EmotionAgent.instance = new EmotionAgent(URLS.WEBSOCKET.EMOTION);
      console.log("EmotionAgent instance created ", URLS.WEBSOCKET.EMOTION);
    }
    return EmotionAgent.instance;
  }

  public updateEmotionCallback: UpdateEmotionCallback;

  private constructor(url: string) {
    super(url);
    this.updateEmotionCallback = () => {};
  }

  protected handleMessage(message: string) {
    const data = JSON.parse(message);
    if (data.type === "pong") return;
    if (data.type === "web:emotion") {
      this.updateEmotionCallback(data.data as EmotionType);
    }
  }

  public setUpdateEmotionCallback(callback: UpdateEmotionCallback) {
    this.updateEmotionCallback = callback;
  }

  public onUpdateEmotion(callback: UpdateEmotionCallback) {
    this.updateEmotionCallback = callback;
  }
}

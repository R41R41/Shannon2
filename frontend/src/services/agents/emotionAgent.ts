import { EmotionType } from "@common/types/taskGraph";
import { WebSocketClientBase } from "../common/WebSocketClient";
import { URLS } from "../config/ports";

type UpdateEmotionCallback = (emotion: EmotionType) => void;

export class EmotionAgent extends WebSocketClientBase {
  private static instance: EmotionAgent;
  private static isConnecting: boolean = false;

  public static getInstance() {
    if (!EmotionAgent.instance) {
      EmotionAgent.instance = new EmotionAgent(URLS.WEBSOCKET.EMOTION);
    }
    return EmotionAgent.instance;
  }

  public updateEmotionCallback: UpdateEmotionCallback;

  private constructor(url: string) {
    super(url);
    this.updateEmotionCallback = () => {};
  }

  public connect() {
    if (EmotionAgent.isConnecting) return;
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return;
    EmotionAgent.isConnecting = true;
    super.connect();
  }

  protected onOpen() {
    super.onOpen();
    EmotionAgent.isConnecting = false;
  }

  protected onClose() {
    super.onClose();
    EmotionAgent.isConnecting = false;
  }

  public disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    EmotionAgent.isConnecting = false;
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

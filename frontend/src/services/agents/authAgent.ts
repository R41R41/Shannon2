import { WebSocketClientBase } from "../common/WebSocketClient";
import { URLS } from "../config/ports";
import { UserInfo } from "@common/types/web";

type AuthCallback = (success: boolean, userData?: UserInfo) => void;

export class AuthAgent extends WebSocketClientBase {
  private static instance: AuthAgent;
  private static isConnecting: boolean = false;
  private authCallback: AuthCallback = () => {};

  public static getInstance() {
    if (!AuthAgent.instance) {
      AuthAgent.instance = new AuthAgent(URLS.WEBSOCKET.AUTH);
    }
    return AuthAgent.instance;
  }

  private constructor(url: string) {
    super(url);
  }

  public connect() {
    if (AuthAgent.isConnecting) return;
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return;
    AuthAgent.isConnecting = true;
    super.connect();
  }

  protected onOpen() {
    super.onOpen();
    AuthAgent.isConnecting = false;
  }

  protected onClose() {
    super.onClose();
    AuthAgent.isConnecting = false;
  }

  protected handleMessage(message: string) {
    const data = JSON.parse(message);
    if (data.type === "auth:response") {
      this.authCallback(data.success, data.userData);
    }
  }

  public async checkAuth(email: string): Promise<void> {
    this.send(
      JSON.stringify({
        type: "auth:check",
        email,
      })
    );
  }

  public onAuthResponse(callback: AuthCallback) {
    this.authCallback = callback;
  }

  public disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    AuthAgent.isConnecting = false;
  }
}

import { WebSocketClientBase } from "../common/WebSocketClient";
import { URLS } from "../config/ports";
import { UserInfo } from "@common/types/web";

type AuthCallback = (success: boolean, userData?: UserInfo) => void;

export class AuthAgent extends WebSocketClientBase {
  private static instance: AuthAgent;
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
    }
  }
}

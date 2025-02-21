import { ILog } from "@common/types/common";
import { SearchQuery } from "@common/types/web";
import { WebSocketClientBase } from "../common/WebSocketClient";
import { URLS } from "../config/ports";

type LogCallback = (log: ILog) => void;
type SearchCallback = (results: ILog[]) => void;

export class MonitoringAgent extends WebSocketClientBase {
  private static instance: MonitoringAgent;
  private static isConnecting: boolean = false;

  public static getInstance() {
    if (!MonitoringAgent.instance) {
      MonitoringAgent.instance = new MonitoringAgent(URLS.WEBSOCKET.MONITORING);
    }
    return MonitoringAgent.instance;
  }

  public logCallback: LogCallback;
  private searchListeners: Set<SearchCallback> = new Set();

  private constructor(url: string) {
    super(url);
    this.logCallback = () => {};
  }

  public connect() {
    if (MonitoringAgent.isConnecting) return;
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return;
    MonitoringAgent.isConnecting = true;
    super.connect();
  }

  protected onOpen() {
    super.onOpen();
    MonitoringAgent.isConnecting = false;
  }

  protected onClose() {
    super.onClose();
    MonitoringAgent.isConnecting = false;
  }

  public disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    MonitoringAgent.isConnecting = false;
  }

  protected handleMessage(message: string) {
    const data = JSON.parse(message);
    if (data.type === "pong") return;
    if (data.type === "web:searchResults") {
      this.searchListeners.forEach((listener) => listener(data.data as ILog[]));
    }
    if (data.type === "web:log") {
      this.logCallback?.(data.data as ILog);
    }
  }

  public setLogCallback(callback: LogCallback) {
    this.logCallback = callback;
  }

  public async searchLogs(query: SearchQuery) {
    this.send(
      JSON.stringify({
        type: "search",
        query,
      })
    );
  }

  public onSearchResults(callback: SearchCallback) {
    this.searchListeners.add(callback);
    return () => this.searchListeners.delete(callback);
  }

  public async getAllMemoryZoneLogs(): Promise<ILog[]> {
    return new Promise((resolve) => {
      const handleAllMemoryZoneLogs = (logs: ILog[]) => {
        this.searchListeners.delete(handleAllMemoryZoneLogs);
        resolve(logs);
      };

      this.searchListeners.add(handleAllMemoryZoneLogs);

      this.send(
        JSON.stringify({
          type: "search",
          query: { memoryZone: "" },
        })
      );
    });
  }
}

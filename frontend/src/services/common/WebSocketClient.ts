export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export abstract class WebSocketClientBase {
  protected ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 60; // 5分 = 60回 (5秒間隔)
  private reconnectDelay = 5000; // 5秒
  private pingInterval: number | null = null;
  private lastPongReceived = 0;
  private pingTimeoutId: number | null = null;
  public status: ConnectionStatus = "disconnected";
  private statusListeners: Array<(status: ConnectionStatus) => void> = [];

  constructor(private url: string) {}

  public connect() {
    console.log("Attempting to connect to:", this.url);
    if (this.ws?.readyState === WebSocket.CONNECTING) {
      console.log("Already connecting to WebSocket");
      return;
    }

    try {
      this.ws = new WebSocket(this.url);
      console.log("WebSocket instance created");
      this.setStatus("connecting");

      this.ws.onopen = () => {
        console.log("WebSocket connection opened");
        this.reconnectAttempts = 0;
        this.setStatus("connected");
        this.startPing();
      };

      this.ws.onmessage = (event) => {
        this.receivePong(event.data);
        this.handleMessage(event.data);
      };

      this.ws.onclose = () => {
        console.log("WebSocket connection closed");
        this.setStatus("disconnected");
        this.reconnect();
      };

      this.ws.onerror = (error) => {
        console.error("WebSocket error:", error);
      };
    } catch (error) {
      console.error("Error creating WebSocket:", error);
    }
  }

  public send(data: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      console.warn("WebSocket is not connected. Current state:", this.status);
      if (this.status === "disconnected") {
        this.connect();
      }
    }
  }

  private startPing() {
    this.stopPing();
    this.pingInterval = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
        this.lastPongReceived = Date.now();
        this.pingTimeoutId = window.setTimeout(() => {
          if (Date.now() - this.lastPongReceived > 30000) {
            this.setStatus("disconnected");
            this.ws?.close();
          }
        }, 5000);
      }
    }, 30000);
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setStatus("disconnected");
      return;
    }

    this.setStatus("connecting");
    this.reconnectAttempts++;
    setTimeout(() => this.connect(), this.reconnectDelay);
  }

  public getStatus(): ConnectionStatus {
    return this.status;
  }

  private setStatus(status: ConnectionStatus) {
    if (this.status !== status) {
      this.status = status;
      this.statusListeners.forEach((listener) => listener(status));
    }
  }

  public addStatusListener(listener: (status: ConnectionStatus) => void) {
    this.statusListeners.push(listener);
  }

  public removeStatusListener(listener: (status: ConnectionStatus) => void) {
    this.statusListeners = this.statusListeners.filter((l) => l !== listener);
  }

  protected abstract handleMessage(data: string): void;

  protected receivePong(data: string) {
    const message = JSON.parse(data);
    if (message.type === "pong") {
      this.lastPongReceived = Date.now();
      this.setStatus("connected");
      if (this.pingTimeoutId) {
        clearTimeout(this.pingTimeoutId);
        this.pingTimeoutId = null;
      }
    }
  }

  public disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }

  protected onOpen(): void {
    console.log("WebSocket Connected");
  }

  protected onClose(): void {
    console.log("WebSocket Disconnected");
  }

  protected onError(error: Event): void {
    console.error("WebSocket Error:", error);
  }
}

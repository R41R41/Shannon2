import { ServiceStatus, StatusAgentOutput } from '@common/types';
import { WebSocketClientBase } from '../common/WebSocketClient';
import { URLS } from '../config/ports';

type StatusCallback = (status: ServiceStatus) => void;

export class StatusAgent extends WebSocketClientBase {
  private static instance: StatusAgent;
  private serviceStatusListeners: Map<string, Set<StatusCallback>> = new Map();

  public static getInstance() {
    if (!StatusAgent.instance) {
      StatusAgent.instance = new StatusAgent(URLS.WEBSOCKET.STATUS);
    }
    return StatusAgent.instance;
  }

  private constructor(url: string) {
    super(url);
  }

  protected handleMessage(message: string) {
    const data = JSON.parse(message) as StatusAgentOutput;
    if (data.type === 'pong') return;

    console.log('\x1b[34mStatus event received\x1b[0m', data);

    const listeners = this.serviceStatusListeners.get(data.service);
    if (listeners && data.data) {
      listeners.forEach((listener) => listener(data.data));
    }
  }

  public onServiceStatus(service: string, callback: StatusCallback) {
    if (!this.serviceStatusListeners.has(service)) {
      this.serviceStatusListeners.set(service, new Set());
    }
    this.serviceStatusListeners.get(service)?.add(callback);
    return () => this.serviceStatusListeners.get(service)?.delete(callback);
  }

  public async getStatusService(service: string) {
    this.send(
      JSON.stringify({
        type: `service:command`,
        command: 'status',
        service,
      })
    );
  }

  public async startService(service: string) {
    this.send(
      JSON.stringify({
        type: `service:command`,
        command: 'start',
        service,
      })
    );
  }

  public async stopService(service: string) {
    this.send(
      JSON.stringify({
        type: `service:command`,
        command: 'stop',
        service,
      })
    );
  }
}

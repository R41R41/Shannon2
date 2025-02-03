import { ServiceStatus } from '@shannon/common';
import { EventBus } from '../eventBus.js';
export abstract class BaseClient {
  public status: ServiceStatus = 'stopped';

  constructor(
    private readonly serviceName: 'twitter' | 'discord' | 'scheduler',
    public eventBus: EventBus
  ) {}

  private async setStatus(newStatus: ServiceStatus) {
    this.status = newStatus;
    this.eventBus.publish({
      type: `web:status`,
      memoryZone: 'web',
      data: {
        service: this.serviceName,
        status: this.status,
      },
    });
  }

  public abstract initialize(): void;

  public async start() {
    if (this.status === 'running') return;
    await this.setStatus('running');
    await this.initialize();
  }

  public async stop() {
    if (this.status === 'stopped') return;
    await this.setStatus('stopped');
  }
}

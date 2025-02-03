import { ServiceStatus } from '@shannon/common';
import { EventBus } from '../eventBus.js';

export class BaseClient {
  public status: ServiceStatus = 'stopped';
  protected static instances: Map<string, BaseClient> = new Map();

  protected constructor(
    private readonly serviceName: 'twitter' | 'discord',
    public eventBus: EventBus
  ) {}

  public static getInstance(
    serviceName: 'twitter' | 'discord',
    eventBus: EventBus,
    isTest?: boolean
  ): BaseClient {
    const key = `${serviceName}${isTest ? ':test' : ''}`;
    if (!this.instances.has(key)) {
      this.instances.set(key, new this(serviceName, eventBus));
    }
    return this.instances.get(key) as BaseClient;
  }

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

  public initialize(): void {}

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

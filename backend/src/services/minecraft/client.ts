import { BaseClient } from '../common/BaseClient.js';
import { EventBus } from '../eventBus.js';

export class MinecraftClient extends BaseClient {
  private static instance: MinecraftClient;
  private minecraftClients: MinecraftClient[];
  public isTest: boolean = false;

  public static getInstance(eventBus: EventBus, isTest: boolean = false) {
    if (!MinecraftClient.instance) {
      MinecraftClient.instance = new MinecraftClient(
        'minecraft',
        eventBus,
        isTest
      );
    }
    MinecraftClient.instance.isTest = isTest;
    return MinecraftClient.instance;
  }

  constructor(
    serviceName: 'minecraft',
    eventBus: EventBus,
    isTest: boolean = false
  ) {
    super(serviceName, eventBus);
    this.minecraftClients = [];
  }

  public async initialize() {
    await this.setupEventBus();
  }

  private async setupEventBus() {}
}

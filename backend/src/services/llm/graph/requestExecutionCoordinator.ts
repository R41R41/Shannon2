import type { RequestEnvelope } from '@shannon/common';

type TaskRunner<T> = () => Promise<T>;

/**
 * Serializes graph execution for lanes that must stay ordered while still
 * allowing unrelated requests to run concurrently.
 */
export class RequestExecutionCoordinator {
  private static instance: RequestExecutionCoordinator;

  private lanes = new Map<string, Promise<unknown>>();

  static getInstance(): RequestExecutionCoordinator {
    if (!RequestExecutionCoordinator.instance) {
      RequestExecutionCoordinator.instance = new RequestExecutionCoordinator();
    }
    return RequestExecutionCoordinator.instance;
  }

  async run<T>(envelope: RequestEnvelope, task: TaskRunner<T>): Promise<T> {
    const laneKey = this.getLaneKey(envelope);
    const previous = this.lanes.get(laneKey) ?? Promise.resolve();

    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lanePromise = previous.then(() => current);
    this.lanes.set(laneKey, lanePromise);

    await previous.catch(() => {});

    try {
      return await task();
    } finally {
      release();
      const active = this.lanes.get(laneKey);
      if (active === lanePromise) {
        this.lanes.delete(laneKey);
      }
    }
  }

  private getLaneKey(envelope: RequestEnvelope): string {
    if (envelope.tags.includes('self_mod_apply')) {
      return 'self-mod:apply';
    }

    if (envelope.channel === 'minecraft') {
      const worldKey = envelope.minecraft?.worldId
        ?? envelope.minecraft?.serverId
        ?? envelope.minecraft?.serverName
        ?? envelope.threadId;
      return `minecraft-world:${worldKey}`;
    }

    return `thread:${envelope.threadId}`;
  }
}

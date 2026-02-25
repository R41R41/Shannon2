import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/models/Log.js', () => ({ default: {} }));
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
}));

const { EventBus } = await import('../../src/services/eventBus/eventBus');

describe('EventBus', () => {
  it('should deliver events to subscribers', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribe('web:log' as any, handler);

    bus.publish({
      type: 'web:log',
      memoryZone: 'web',
      data: { content: 'test' },
    } as any);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should allow unsubscribe', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsub = bus.subscribe('web:log' as any, handler);
    unsub();

    bus.publish({
      type: 'web:log',
      memoryZone: 'web',
      data: { content: 'test' },
    } as any);

    expect(handler).not.toHaveBeenCalled();
  });

  it('should catch synchronous listener errors without crashing', () => {
    const bus = new EventBus();
    const badHandler = () => { throw new Error('sync boom'); };
    const goodHandler = vi.fn();

    bus.subscribe('web:log' as any, badHandler);
    bus.subscribe('web:log' as any, goodHandler);

    bus.publish({
      type: 'web:log',
      memoryZone: 'web',
      data: { content: 'test' },
    } as any);

    expect(goodHandler).toHaveBeenCalledTimes(1);
  });

  it('should catch async listener errors without crashing', async () => {
    const bus = new EventBus();
    const badHandler = async () => { throw new Error('async boom'); };
    const goodHandler = vi.fn();

    bus.subscribe('web:log' as any, badHandler);
    bus.subscribe('web:log' as any, goodHandler);

    bus.publish({
      type: 'web:log',
      memoryZone: 'web',
      data: { content: 'test' },
    } as any);

    await new Promise((r) => setTimeout(r, 10));
    expect(goodHandler).toHaveBeenCalledTimes(1);
  });
});

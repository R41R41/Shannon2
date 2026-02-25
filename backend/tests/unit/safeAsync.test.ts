import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
}));

const { safeAsync } = await import('../../src/utils/safeAsync');
const { logger } = await import('../../src/utils/logger');

describe('safeAsync', () => {
  it('should execute async function without error', async () => {
    const fn = vi.fn(async () => {});
    safeAsync('test', fn);
    await new Promise((r) => setTimeout(r, 10));
    expect(fn).toHaveBeenCalled();
  });

  it('should catch and log errors from async function', async () => {
    safeAsync('test-error', async () => {
      throw new Error('test failure');
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('test failure')
    );
  });
});

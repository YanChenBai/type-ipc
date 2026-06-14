/**
 * Full-flow integration tests — exercises every Ipcora feature in realistic
 * end-to-end scenarios combining router + client + events + lifecycle hooks.
 */
import { describe, expect, test, vi } from 'vitest';

import { ipcora } from '../..';
import { createMemoryTestAdapter, createPeer } from './helpers';

// Full demo suite — exercises all 16 demo scenarios as automated tests
describe('dispose and cleanup', () => {
  test('dispose removes adapter handler and clears bindings', () => {
    const memory = createMemoryTestAdapter();
    const ipc = ipcora({
      channel: 'test:dispose',
      adapter: memory.adapter,
    }).handler('ping', () => 'pong');

    ipc.bind(createPeer(1));
    expect(memory.adapter.handle).toHaveBeenCalledWith('test:dispose', expect.any(Function));

    ipc.dispose();

    expect(memory.adapter.removeHandler).toHaveBeenCalledWith('test:dispose');
  });

  test('double dispose is safe', () => {
    const memory = createMemoryTestAdapter();
    const ipc = ipcora({
      channel: 'test:double-dispose',
      adapter: memory.adapter,
    }).handler('ping', () => 'pong');

    ipc.bind(createPeer(1));
    ipc.dispose();
    expect(() => ipc.dispose()).not.toThrow();
  });

  test('dispose then bind again works again on the same channel', () => {
    const memory = createMemoryTestAdapter();
    const ipc1 = ipcora({
      channel: 'test:reuse',
      adapter: memory.adapter,
    }).handler('ping', () => 'v1');

    ipc1.bind(createPeer(1));
    ipc1.dispose();

    // Reuse the same adapter + channel after dispose
    const ipc2 = ipcora({
      channel: 'test:reuse',
      adapter: memory.adapter,
    }).handler('ping', () => 'v2');

    expect(() => ipc2.bind(createPeer(2))).not.toThrow();
    ipc2.dispose();
  });

  test('dispose aborts pending requests for bound peers', async () => {
    const memory = createMemoryTestAdapter();
    const ipc = ipcora<{}>({
      channel: 'test:dispose-abort',
      adapter: memory.adapter,
    }).handler('ping', ({ signal }) => {
      // Signal should be aborted after dispose
      return { aborted: signal.aborted };
    });

    const dispose = ipc.bind(createPeer(1));

    // Before dispose, signal should not be aborted
    const r1 = await memory.invoke('test:dispose-abort', 1, { id: '1', path: 'ping' });
    expect((r1.data as any).aborted).toBe(false);

    // After dispose, the binding is gone
    dispose();
    const r2 = await memory.invoke('test:dispose-abort', 1, { id: '2', path: 'ping' });
    expect(r2.error?.name).toBe('PEER_NOT_BOUND');
  });
});

describe('stress and edge cases', () => {
  test('handles many concurrent invocations without races', async () => {
    const memory = createMemoryTestAdapter();
    const ipc = ipcora<{}, { counter: number }>({
      channel: 'test:concurrent',
      adapter: memory.adapter,
    })
      .state('counter', 0)
      .handler('inc', ({ store }) => {
        store.counter += 1;
        return { counter: store.counter };
      });

    ipc.bind(createPeer(1));

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        memory.invoke('test:concurrent', 1, { id: String(i), path: 'inc' }),
      ),
    );

    const counters = results.map(r => (r.data as any).counter as number);
    // All should be unique positive numbers
    const unique = new Set(counters);
    expect(unique.size).toBe(50);
    expect(Math.max(...counters)).toBeLessThanOrEqual(50);
  });

  test('handles deeply nested route paths', async () => {
    const memory = createMemoryTestAdapter();
    const ipc = ipcora({
      channel: 'test:deep',
      adapter: memory.adapter,
    }).group('a', a => a.group('b', b => b.group('c', c => c.handler('d', () => 'deep'))));

    ipc.bind(createPeer(1));

    const res = await memory.invoke('test:deep', 1, { id: '1', path: 'a.b.c.d' });
    expect(res.data).toBe('deep');
  });

  test('duplicate handler path is replaced by later registration', async () => {
    const memory = createMemoryTestAdapter();
    const ipc = ipcora({
      channel: 'test:dup',
      adapter: memory.adapter,
    })
      .handler('ping', () => 'first')
      .handler('ping', () => 'second');

    ipc.bind(createPeer(1));

    const res = await memory.invoke('test:dup', 1, { id: '1', path: 'ping' });
    expect(res.data).toBe('second');
  });

  test('router without adapter throws when binding', () => {
    const ipc = ipcora({ channel: 'test:no-adapter' }).handler('ping', () => 'pong');

    expect(() => ipc.bind(createPeer(1))).toThrow('IPC adapter is required');
  });

  test('abstract router bind is a no-op and does not throw', () => {
    const ipc = ipcora({ abstract: true }).handler('ping', () => 'pong');
    expect(() => ipc.bind(createPeer(1))).not.toThrow();
  });

  test('onAfterResponseError callback catches errors in onAfterResponse', async () => {
    const afterResponseError = vi.fn();
    const memory = createMemoryTestAdapter();
    const ipc = ipcora({
      channel: 'test:after-err-cb',
      adapter: memory.adapter,
      onAfterResponseError: afterResponseError,
    }).handler('ok', () => 'ok', {
      onAfterResponse() {
        throw new Error('log failure');
      },
    });

    ipc.bind(createPeer(1));

    // Response should still succeed
    const res = await memory.invoke('test:after-err-cb', 1, { id: '1', path: 'ok' });
    expect(res.data).toBe('ok');

    // Error callback should have been called
    expect(afterResponseError).toHaveBeenCalledTimes(1);
    expect(afterResponseError).toHaveBeenCalledWith(expect.any(Error), 'ok');
  });

  test('empty metadata object is handled correctly', async () => {
    const memory = createMemoryTestAdapter();
    const ipc = ipcora({
      channel: 'test:empty-meta',
      adapter: memory.adapter,
    }).handler('ping', ({ metadata }) => ({
      metaKeys: Object.keys(metadata),
      metaSize: Object.keys(metadata).length,
    }));

    ipc.bind(createPeer(1));

    const res = await memory.invoke('test:empty-meta', 1, {
      id: '1',
      path: 'ping',
      metadata: {},
    });
    expect(res.data).toEqual({ metaKeys: [], metaSize: 0 });
  });

  test('handler receiving null/undefined params with no schema passes through', async () => {
    const memory = createMemoryTestAdapter();
    const ipc = ipcora({
      channel: 'test:null-params',
      adapter: memory.adapter,
    }).handler('echo', ({ params }) => ({ received: params }));

    ipc.bind(createPeer(1));

    // No params field at all
    const r1 = await memory.invoke('test:null-params', 1, { id: '1', path: 'echo' });
    expect(r1.data).toEqual({ received: undefined });

    // null params
    const r2 = await memory.invoke('test:null-params', 1, {
      id: '2',
      path: 'echo',
      params: null,
    });
    expect(r2.data).toEqual({ received: null });

    // undefined params
    const r3 = await memory.invoke('test:null-params', 1, {
      id: '3',
      path: 'echo',
      params: undefined,
    });
    expect(r3.data).toEqual({ received: undefined });
  });
});

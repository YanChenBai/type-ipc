import { beforeEach, describe, expect, expectTypeOf, test } from 'vitest';

import { ipcora } from '../..';
import { createMemoryTestAdapter, createPeer, schema, type MemoryTestAdapter } from './helpers';

let ipcAdapter: MemoryTestAdapter = createMemoryTestAdapter();

beforeEach(() => {
  ipcAdapter = createMemoryTestAdapter();
});

describe('Ipcora router', () => {
  test('returns a successful handler response', async () => {
    const ipc = ipcora<{ tenant: string }>({
      channel: 'test:success',
      adapter: ipcAdapter.adapter,
    })
      .decorate('tenant', 'acme')
      .handler('ping', ({ tenant }) => ({ pong: tenant }));
    ipc.bind(createPeer(1));

    await expect(ipcAdapter.invoke('test:success', 1, { id: '1', path: 'ping' })).resolves.toEqual({
      data: { pong: 'acme' },
    });
  });

  test('binds multiple peers at once', async () => {
    const ipc = ipcora({
      channel: 'test:bind-many',
      adapter: ipcAdapter.adapter,
    }).handler('who', ({ peer }) => ({ peerId: peer.sender.id }));

    const unbind = ipc.bind(createPeer(1), createPeer(2));

    await expect(ipcAdapter.invoke('test:bind-many', 1, { id: '1', path: 'who' })).resolves.toEqual(
      {
        data: { peerId: 1 },
      },
    );
    await expect(ipcAdapter.invoke('test:bind-many', 2, { id: '2', path: 'who' })).resolves.toEqual(
      {
        data: { peerId: 2 },
      },
    );

    unbind();

    await expect(
      ipcAdapter.invoke('test:bind-many', 1, { id: '3', path: 'who' }),
    ).resolves.toMatchObject({
      error: { name: 'PEER_NOT_BOUND' },
    });
    await expect(
      ipcAdapter.invoke('test:bind-many', 2, { id: '4', path: 'who' }),
    ).resolves.toMatchObject({
      error: { name: 'PEER_NOT_BOUND' },
    });
  });

  test('exposes a fully inferred route definition for clients', () => {
    const stringParams = schema<string>(value =>
      typeof value === 'string' ? { value } : { issues: [{ message: 'Expected string' }] },
    );
    const ipc = ipcora({ channel: 'test:definition', adapter: ipcAdapter.adapter })
      .handler('user.read', async ({ params }) => ({ id: params }), {
        params: stringParams,
      })
      .group('project', app => app.handler('list', () => [{ id: 'project-1' }]));

    expectTypeOf(ipc.manifest.user.read).toExtend<
      (params: string) => Promise<{ data: { id: string } | null; error: unknown }>
    >();
    expectTypeOf(ipc.manifest.project.list).toExtend<
      () => Promise<{ data: { id: string }[] | null; error: unknown }>
    >();
    expect(ipc.manifest).toMatchObject({
      user: { read: expect.any(Function) },
      project: { list: expect.any(Function) },
    });
  });
  test('joins group paths with handler paths', async () => {
    const ipc = ipcora({ channel: 'test:group', adapter: ipcAdapter.adapter }).group(
      'system',
      app => app.handler('restart', () => 'ok'),
    );
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:group', 1, { id: '1', path: 'system.restart' }),
    ).resolves.toEqual({
      data: 'ok',
    });
  });
});
describe('multi-handler', () => {
  test('multiple handlers on one instance are independent', async () => {
    const ipc = ipcora({
      channel: 'test:multi-handler',
      adapter: ipcAdapter.adapter,
    })
      .handler('a', () => 'result-a')
      .handler('b', () => 'result-b');
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:multi-handler', 1, { id: '1', path: 'a' }),
    ).resolves.toEqual({
      data: 'result-a',
    });

    await expect(
      ipcAdapter.invoke('test:multi-handler', 1, { id: '2', path: 'b' }),
    ).resolves.toEqual({
      data: 'result-b',
    });
  });

  test('each handler gets its own hook chain', async () => {
    const calls: string[] = [];
    const ipc = ipcora({
      channel: 'test:hook-per-route',
      adapter: ipcAdapter.adapter,
    })
      .onBeforeHandle(() => {
        calls.push('hook');
      })
      .handler('first', () => {
        calls.push('first');
        return 'ok';
      })
      .handler('second', () => {
        calls.push('second');
        return 'ok';
      });
    ipc.bind(createPeer(1));

    calls.length = 0;
    await ipcAdapter.invoke('test:hook-per-route', 1, { id: '1', path: 'first' });
    expect(calls).toEqual(['hook', 'first']);

    calls.length = 0;
    await ipcAdapter.invoke('test:hook-per-route', 1, { id: '2', path: 'second' });
    expect(calls).toEqual(['hook', 'second']);
  });
});

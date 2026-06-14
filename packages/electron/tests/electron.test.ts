import { BrowserWindow } from 'electron';
import type { BaseWindow } from 'electron';
import type { StandardSchemaV1 } from 'ipcora';
import { defineEvents } from 'ipcora/event';
import { assertType, beforeEach, describe, expect, test, vi } from 'vitest';

const electronHandlers = vi.hoisted(
  () => new Map<string, (event: unknown, request: unknown) => unknown>(),
);

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(),
  },
  contextBridge: {
    exposeInMainWorld: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, request: unknown) => unknown) => {
      electronHandlers.set(channel, handler);
    }),
    listenerCount: vi.fn((channel: string) => (electronHandlers.has(channel) ? 1 : 0)),
    removeHandler: vi.fn((channel: string) => {
      electronHandlers.delete(channel);
    }),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

import {
  bindWindow,
  electronIpcAdapter,
  electronBrowserWindowPeer,
  electronIpcora,
  ELECTRON_IPCORA_CHANNEL,
} from '../src/main';
import { electronIpcoraClient } from '../src/renderer';

// Test helpers

function createWindow(id = 1) {
  return {
    id,
    webContents: { id, send: vi.fn() },
    once: vi.fn(),
  };
}

function schema<TOutput>(): StandardSchemaV1<unknown, TOutput> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value: unknown) => ({ value: value as TOutput }),
    },
  };
}

// Main process

describe('@ipcora/electron/main', () => {
  beforeEach(() => {
    electronHandlers.clear();
  });

  test('adapts ipcMain to an ipcora adapter', async () => {
    const adapter = electronIpcAdapter();

    adapter.handle('test', () => ({ data: 'ok' }));

    await expect(
      Promise.resolve(electronHandlers.get('test')?.({ sender: { id: 1 } }, { id: '1' })),
    ).resolves.toEqual({
      data: 'ok',
    });
    expect(adapter.listenerCount('test')).toBe(1);
    const sender = { id: 1, send: vi.fn() };
    adapter.emit('test:event:update', sender as never, { title: 'Main Window' });
    expect(sender.send).toHaveBeenCalledWith('test:event:update', { title: 'Main Window' });

    adapter.removeHandler('test');
    expect(adapter.listenerCount('test')).toBe(0);
  });

  test('keeps adapter sender as the original WebContents sender', async () => {
    const adapter = electronIpcAdapter();
    const sender = { id: 101, send: vi.fn() };
    vi.mocked(BrowserWindow.fromWebContents).mockClear();

    adapter.handle('test', event => ({ data: { senderId: event.sender.id } }));

    await expect(
      Promise.resolve(electronHandlers.get('test')?.({ sender }, { id: '1' })),
    ).resolves.toEqual({
      data: { senderId: 101 },
    });
    expect(BrowserWindow.fromWebContents).not.toHaveBeenCalled();
  });

  test('creates peers from BrowserWindow-like objects', () => {
    const window = createWindow(7);
    const peer = electronBrowserWindowPeer(window as never);

    expect(peer.sender.id).toBe(7);
    expect(peer.sender).toBe(window.webContents);

    const dispose = vi.fn();
    peer.onDispose?.(dispose);
    expect(window.once).toHaveBeenCalledWith('closed', dispose);
  });

  test('creates electron ipcora with the fixed channel', () => {
    const ipcora = electronIpcora();

    expect(ipcora.channel).toBe(ELECTRON_IPCORA_CHANNEL);
  });

  test('binds BrowserWindow peers to an electron ipcora instance by window id', async () => {
    const ipcora = electronIpcora();
    ipcora.handler('ping', () => 'pong');

    bindWindow(ipcora, createWindow(1) as unknown as BrowserWindow);

    await expect(
      electronHandlers.get(ELECTRON_IPCORA_CHANNEL)?.(
        { sender: { id: 1 } },
        { id: '1', path: 'ping' },
      ),
    ).resolves.toEqual({
      data: 'pong',
    });
  });

  test('resolves BrowserWindow into handler context', async () => {
    const ipcora = electronIpcora();
    ipcora.handler('windowId', ({ browserWindow }) => ({ windowId: browserWindow.id }), {
      browserWindow: true,
    });

    bindWindow(ipcora, createWindow(2) as unknown as BrowserWindow);

    await expect(
      electronHandlers.get(ELECTRON_IPCORA_CHANNEL)?.(
        { sender: { id: 2 } },
        { id: '1', path: 'windowId' },
      ),
    ).resolves.toEqual({
      data: { windowId: 2 },
    });
  });

  test('allows the built-in browserWindow macro to expose BrowserWindow context', () => {
    const ipcora = electronIpcora();

    ipcora.handler(
      'windowWebContentsId',
      ({ browserWindow }) => {
        assertType<BrowserWindow>(browserWindow);
        return browserWindow.webContents.id;
      },
      { browserWindow: true },
    );
  });

  test('allows the built-in baseWindow macro to expose BaseWindow context', () => {
    const ipcora = electronIpcora();

    ipcora.handler(
      'baseWindowId',
      ({ baseWindow }) => {
        assertType<BaseWindow>(baseWindow);
        return baseWindow.id;
      },
      { baseWindow: true },
    );
  });

  test('infers BaseWindow context from the built-in baseWindow macro inside groups', () => {
    electronIpcora().group('check', check =>
      check.handler(
        'baseWindowId',
        ({ baseWindow }) => {
          assertType<BaseWindow>(baseWindow);
          return baseWindow.id;
        },
        { baseWindow: true },
      ),
    );
  });

  test('keeps typed emit helpers when using the built-in baseWindow macro inside groups', () => {
    electronIpcora()
      .events(
        defineEvents({
          updated: schema<string>(),
        }),
      )
      .group('check', check =>
        check.handler(
          'baseWindowId',
          ({ $emit, emit, baseWindow }) => {
            assertType<BaseWindow>(baseWindow);
            assertType<(payload: string) => Promise<void>>($emit.updated);
            assertType<(name: 'updated', payload: string) => Promise<void>>(emit);
            return baseWindow.id;
          },
          { baseWindow: true },
        ),
      );
  });

  test('resolves the built-in browserWindow macro from BrowserWindow.fromWebContents', async () => {
    const ipcora = electronIpcora();
    const resolvedWindow = createWindow(9);
    const boundWindow = createWindow(9);

    vi.mocked(BrowserWindow.fromWebContents).mockReturnValueOnce(
      resolvedWindow as unknown as BrowserWindow,
    );
    ipcora.handler('windowId', ({ browserWindow }) => browserWindow.id, { browserWindow: true });
    bindWindow(ipcora, boundWindow as unknown as BrowserWindow);

    await expect(
      electronHandlers.get(ELECTRON_IPCORA_CHANNEL)?.(
        { sender: boundWindow.webContents },
        { id: '1', path: 'windowId' },
      ),
    ).resolves.toEqual({
      data: 9,
    });
  });

  test('resolves the built-in baseWindow macro to the bound BaseWindow', async () => {
    const ipcora = electronIpcora();
    const boundWindow = createWindow(11);

    vi.mocked(BrowserWindow.fromWebContents).mockReturnValueOnce(null);
    ipcora.handler('windowId', ({ baseWindow }) => baseWindow.id, { baseWindow: true });
    bindWindow(ipcora, boundWindow as unknown as BrowserWindow);

    await expect(
      electronHandlers.get(ELECTRON_IPCORA_CHANNEL)?.(
        { sender: boundWindow.webContents },
        { id: '1', path: 'windowId' },
      ),
    ).resolves.toEqual({
      data: 11,
    });
  });

  test('binds grouped electron ipcora chains with typed events', () => {
    const ipcora = electronIpcora()
      .handler('ping', () => 'pong')
      .group('check', check => check.handler('schemaParsed', () => ({ name: 1 })))
      .events(
        defineEvents({
          updated: schema<string>(),
        }),
      );

    const binding = bindWindow(ipcora, createWindow(1) as unknown as BrowserWindow);
    assertType<{ updated: (payload: string) => Promise<void> }>(binding.$emit);
  });

  test('returns a bound window emitter', async () => {
    const ipcora = electronIpcora().events(
      defineEvents({
        update: schema<{ title: string }>(),
      }),
    );
    const window = createWindow(5);
    const binding = bindWindow(ipcora, window as unknown as BrowserWindow);

    await binding.emit('update', { title: 'direct' });
    await binding.$emit.update({ title: 'proxy' });

    expect(binding.id).toBe(5);
    expect(window.webContents.send).toHaveBeenCalledWith(
      `${ELECTRON_IPCORA_CHANNEL}:event:update`,
      {
        title: 'direct',
      },
    );
    expect(window.webContents.send).toHaveBeenCalledWith(
      `${ELECTRON_IPCORA_CHANNEL}:event:update`,
      {
        title: 'proxy',
      },
    );

    binding.unbind();
    expect(window.once.mock.calls[0][0]).toBe('closed');
  });

  test('returns a nested bound window emitter for namespaced events', async () => {
    const ipcora = electronIpcora().events(
      defineEvents({
        user: {
          created: schema<{ name: string }>(),
        },
      }),
    );
    const window = createWindow(6);
    const binding = bindWindow(ipcora, window as unknown as BrowserWindow);

    assertType<(payload: { name: string }) => Promise<void>>(binding.$emit.user.created);
    await binding.$emit.user.created({ name: 'Ada' });

    expect(window.webContents.send).toHaveBeenCalledWith(
      `${ELECTRON_IPCORA_CHANNEL}:event:user.created`,
      {
        name: 'Ada',
      },
    );
  });

  test('does not expose dotted keys on bound window emitters', () => {
    const ipcora = electronIpcora().events(
      defineEvents({
        user: {
          created: schema<{ name: string }>(),
        },
      }),
    );
    const window = createWindow(7);
    const binding = bindWindow(ipcora, window as unknown as BrowserWindow);

    expect((binding.$emit as Record<string, unknown>)['user.created']).toBeUndefined();
    expect(typeof binding.$emit.user.created).toBe('function');
  });

  test('keeps direct bound emit support for dotted event names', async () => {
    const ipcora = electronIpcora().events(
      defineEvents({
        user: {
          created: schema<{ name: string }>(),
        },
      }),
    );
    const window = createWindow(8);
    const binding = bindWindow(ipcora, window as unknown as BrowserWindow);

    await binding.emit('user.created', { name: 'Grace' });

    expect(window.webContents.send).toHaveBeenCalledWith(
      `${ELECTRON_IPCORA_CHANNEL}:event:user.created`,
      {
        name: 'Grace',
      },
    );
  });
});

// Preload

describe('@ipcora/electron/preload', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test('exposes invoke and subscribe via contextBridge', async () => {
    const exposed: Record<string, unknown> = {};
    const ipcRendererOn = vi.fn();
    const ipcRendererRemove = vi.fn();
    const ipcRendererInvoke = vi.fn().mockResolvedValue({ data: 'ok' });

    vi.doMock('electron', () => ({
      contextBridge: {
        exposeInMainWorld: vi.fn((key: string, api: unknown) => {
          exposed[key] = api;
        }),
      },
      ipcRenderer: {
        invoke: ipcRendererInvoke,
        on: ipcRendererOn,
        removeListener: ipcRendererRemove,
      },
    }));

    // Dynamic import to pick up the mock
    const { exposeIpcoraBridge: bridgeFn } = await import('../src/preload');
    bridgeFn();

    const bridge = exposed.__IPCORA__ as {
      invoke: (req: unknown) => Promise<unknown>;
      subscribe: (ch: string, cb: (p: unknown) => void) => () => void;
    };

    // invoke
    const invokeResult = bridge.invoke({ id: 'r1', path: 'ping' });
    expect(ipcRendererInvoke).toHaveBeenCalledWith(ELECTRON_IPCORA_CHANNEL, {
      id: 'r1',
      path: 'ping',
    });
    await expect(invokeResult).resolves.toEqual({ data: 'ok' });

    // subscribe
    const listener = vi.fn();
    const unsub = bridge.subscribe('app:ipc:event:update', listener);
    expect(ipcRendererOn).toHaveBeenCalledWith('app:ipc:event:update', expect.any(Function));

    // Simulate event
    const handler = ipcRendererOn.mock.calls[0][1];
    handler({}, { title: 'hello' });
    expect(listener).toHaveBeenCalledWith({ title: 'hello' });

    // unsubscribe
    unsub();
    expect(ipcRendererRemove).toHaveBeenCalledWith('app:ipc:event:update', expect.any(Function));
  });
});

// Renderer

describe('@ipcora/electron/renderer', () => {
  test('creates typed client backed by preload bridge', async () => {
    // Simulate preload bridge on window
    const invokeMock = vi.fn().mockResolvedValue({ data: 'pong' });
    const subscribeMock = vi.fn().mockReturnValue(() => {});

    vi.stubGlobal('window', {
      __IPCORA__: {
        invoke: invokeMock,
        subscribe: subscribeMock,
      },
    });

    // Minimal definition type (used only for type inference)
    const definition = {
      ping: (() => {}) as unknown as () => Promise<{ data: string; error: null }>,
    };

    const client = electronIpcoraClient<{ handlers: typeof definition; events: {} }>();

    const result = await client.invoke.ping();
    expect(result).toEqual({ data: 'pong', error: null });
    expect(invokeMock).toHaveBeenCalledWith({
      id: expect.stringMatching(/^ping-/),
      path: 'ping',
      params: undefined,
      metadata: undefined,
    });
  });

  test('returns data directly when throwInvokeError is enabled', async () => {
    const invokeMock = vi.fn().mockResolvedValue({ data: 'pong' });

    vi.stubGlobal('window', {
      __IPCORA__: {
        invoke: invokeMock,
        subscribe: vi.fn().mockReturnValue(() => {}),
      },
    });

    const definition = {
      ping: (() => {}) as unknown as () => Promise<{ data: string; error: null }>,
    };

    const client = electronIpcoraClient<{ handlers: typeof definition; events: {} }>({
      throwInvokeError: true,
    });

    assertType<Promise<string>>(client.invoke.ping());
    await expect(client.invoke.ping()).resolves.toBe('pong');
  });

  test('passes params through to bridge invoke', async () => {
    const invokeMock = vi.fn().mockResolvedValue({ data: 'ok' });
    const subscribeMock = vi.fn().mockReturnValue(() => {});

    vi.stubGlobal('window', {
      __IPCORA__: {
        invoke: invokeMock,
        subscribe: subscribeMock,
      },
    });

    // Definition type with params
    const definition = {
      getUser: ((_params: { id: string }) => {}) as unknown as (params: {
        id: string;
      }) => Promise<{ data: { id: string }; error: null }>,
    };

    const client = electronIpcoraClient<{ handlers: typeof definition; events: {} }>();

    await client.invoke.getUser({ id: '42' });
    expect(invokeMock).toHaveBeenCalledWith({
      id: expect.stringMatching(/^getUser-/),
      path: 'getUser',
      params: { id: '42' },
      metadata: undefined,
    });
  });

  test('throws when bridge is not exposed', () => {
    vi.stubGlobal('window', {});

    expect(() => electronIpcoraClient()).toThrow(/Ipcora bridge not found at window\.__IPCORA__/);
  });

  test('passes static metadata from options', async () => {
    const invokeMock = vi.fn().mockResolvedValue({ data: 'ok' });
    vi.stubGlobal('window', {
      __IPCORA__: {
        invoke: invokeMock,
        subscribe: vi.fn().mockReturnValue(() => {}),
      },
    });

    const definition = {
      ping: (() => {}) as unknown as () => Promise<{ data: string; error: null }>,
    };

    const client = electronIpcoraClient<{ handlers: typeof definition; events: {} }>({
      metadata: { traceId: 't-123' },
    });

    await client.invoke.ping();
    expect(invokeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { traceId: 't-123' },
      }),
    );
  });

  test('passes shared event schemas to renderer subscriptions', () => {
    const invokeMock = vi.fn();
    const subscribeMock = vi.fn().mockReturnValue(() => {});
    vi.stubGlobal('window', {
      __IPCORA__: {
        invoke: invokeMock,
        subscribe: subscribeMock,
      },
    });

    const createdSchema = schema<{ name: string }>();
    const events = defineEvents({
      user: {
        created: createdSchema,
      },
    });

    const client = electronIpcoraClient({ eventSchema: events });

    assertType<(listener: (payload: { name: string }) => void) => () => void>(
      client.event.user.onCreated,
    );
    client.event.user.onCreated(() => {});

    expect(subscribeMock).toHaveBeenCalledWith(
      `${ELECTRON_IPCORA_CHANNEL}:event:user.created`,
      expect.any(Function),
    );
  });
});

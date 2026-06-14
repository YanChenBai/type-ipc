import { describe, expect, test, vi } from 'vitest';

import { ipcoraClient } from '..';

const server = {
  window: {
    open(windowId: string) {
      return {
        windowId,
      };
    },

    update(params: { title: string; size: [number, number] }) {
      return params;
    },

    raw: {
      move(windowId: string) {
        return `Hello, ${windowId}`;
      },
    },
  },
};

describe('ipcoraClient', () => {
  test('calls a nested method', async () => {
    const invoke = vi.fn(({ channel, args }) => {
      if (channel === 'window.raw.move') {
        return `Hello, ${args[0]}`;
      }
    });

    const client = ipcoraClient<{ handlers: typeof server; events: {} }>({
      adapter: { invoke },
    });

    await expect(client.invoke.window.raw.move('window:index:0')).resolves.toEqual({
      data: 'Hello, window:index:0',
      error: null,
    });

    expect(invoke).toHaveBeenCalledOnce();

    expect(invoke).toHaveBeenCalledWith({
      path: ['window', 'raw', 'move'],
      channel: 'window.raw.move',
      namespace: 'window.raw',
      method: 'move',
      args: ['window:index:0'],
    });
  });

  test('calls a top-level namespace method', async () => {
    const invoke = vi.fn(({ args }) => {
      return {
        windowId: args[0],
      };
    });

    const client = ipcoraClient<{ handlers: typeof server; events: {} }>({
      adapter: { invoke },
    });

    await expect(client.invoke.window.open('main')).resolves.toEqual({
      data: { windowId: 'main' },
      error: null,
    });

    expect(invoke).toHaveBeenCalledWith({
      path: ['window', 'open'],
      channel: 'window.open',
      namespace: 'window',
      method: 'open',
      args: ['main'],
    });
  });

  test('passes object parameters', async () => {
    const invoke = vi.fn(({ args }) => args[0]);

    const client = ipcoraClient<{ handlers: typeof server; events: {} }>({
      adapter: { invoke },
    });

    const params = {
      title: 'Main Window',
      size: [1280, 720] as [number, number],
    };

    await expect(client.invoke.window.update(params)).resolves.toEqual({
      data: params,
      error: null,
    });

    expect(invoke).toHaveBeenCalledWith({
      path: ['window', 'update'],
      channel: 'window.update',
      namespace: 'window',
      method: 'update',
      args: [params],
    });
  });

  test('supports asynchronous invoke', async () => {
    const invoke = vi.fn(async ({ channel, args }) => {
      return {
        channel,
        windowId: args[0],
      };
    });

    const client = ipcoraClient<{ handlers: typeof server; events: {} }>({
      adapter: { invoke },
    });

    await expect(client.invoke.window.open('main')).resolves.toEqual({
      data: {
        channel: 'window.open',
        windowId: 'main',
      },
      error: null,
    });
  });

  test('does not expose client as a promise', () => {
    const client = ipcoraClient<{ handlers: typeof server; events: {} }>({
      adapter: { invoke: vi.fn() },
    });

    expect((client as unknown as { then?: unknown }).then).toBeUndefined();
  });

  test('calls arbitrary paths without a runtime definition', async () => {
    const invoke = vi.fn(() => 'ok');
    const client = ipcoraClient<{ handlers: typeof server; events: {} }>({
      adapter: { invoke },
    });

    await expect(
      (
        client.invoke as unknown as {
          unknown: {
            method(value: string): Promise<unknown>;
          };
        }
      ).unknown.method('value'),
    ).resolves.toEqual({ data: 'ok', error: null });

    expect(invoke).toHaveBeenCalledWith({
      path: ['unknown', 'method'],
      channel: 'unknown.method',
      namespace: 'unknown',
      method: 'method',
      args: ['value'],
    });
  });

  test('does not execute the server implementation directly', async () => {
    const move = vi.fn(() => 'server result');

    const definition = {
      window: {
        raw: {
          move,
        },
      },
    };

    const invoke = vi.fn(() => 'client result');

    const client = ipcoraClient<{ handlers: typeof definition; events: {} }>({
      adapter: { invoke },
    });

    await expect(client.invoke.window.raw.move()).resolves.toEqual({
      data: 'client result',
      error: null,
    });

    expect(move).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledOnce();
  });
});

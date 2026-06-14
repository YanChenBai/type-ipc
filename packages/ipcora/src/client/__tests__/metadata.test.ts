import { describe, expect, expectTypeOf, test, vi } from 'vitest';

import { ClientIpcError, ipcoraClient } from '..';

const metaDefinition = {
  noParams: () => 'ok',
  withParams: (name: string) => `Hello, ${name}`,
};

describe('metadata', () => {
  test('static metadata is merged into every call', async () => {
    const invoke = vi.fn(() => 'result');

    const client = ipcoraClient<{ handlers: typeof metaDefinition; events: {} }>({
      adapter: { invoke },
      metadata: { env: 'test', version: 1 },
    });

    await client.invoke.noParams();

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { env: 'test', version: 1 } }),
    );
  });

  test('hooks.onInvoke runs per-call and returned metadata is merged', async () => {
    const invoke = vi.fn(() => 'result');
    const onInvoke = vi.fn(call => ({ metadata: { channel: call.channel, dynamic: true } }));

    const client = ipcoraClient<{ handlers: typeof metaDefinition; events: {} }>({
      adapter: { invoke },
      hooks: { onInvoke: [onInvoke] },
    });

    await client.invoke.noParams();

    expect(onInvoke).toHaveBeenCalledOnce();
    expect(onInvoke).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'noParams', metadata: {} }),
    );
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { channel: 'noParams', dynamic: true },
      }),
    );
  });

  test('hooks.onInvoke receives current metadata and can override static metadata', async () => {
    const invoke = vi.fn(() => 'result');
    const onInvoke = vi.fn(({ metadata }) => ({
      metadata: { seen: metadata.a, b: 3, c: 4 },
    }));

    const client = ipcoraClient<{ handlers: typeof metaDefinition; events: {} }>({
      adapter: { invoke },
      metadata: { a: 1, b: 2 },
      hooks: { onInvoke: [onInvoke] },
    });

    await client.invoke.noParams();

    expect(onInvoke).toHaveBeenCalledWith(expect.objectContaining({ metadata: { a: 1, b: 2 } }));
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { a: 1, b: 3, c: 4, seen: 1 },
      }),
    );
  });

  test('per-call metadata overrides both static and hook', async () => {
    const invoke = vi.fn(() => 'result');

    const client = ipcoraClient<{ handlers: typeof metaDefinition; events: {} }>({
      adapter: { invoke },
      metadata: { a: 1, b: 2 },
      hooks: { onInvoke: [() => ({ metadata: { b: 3, c: 4 } })] },
    });

    await client.invoke.withParams('alice', { c: 5, d: 6 });

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['alice'],
        metadata: { a: 1, b: 3, c: 5, d: 6 },
      }),
    );
  });

  test('hooks.onInvoke entries merge in order', async () => {
    const invoke = vi.fn(() => 'result');

    const client = ipcoraClient<{ handlers: typeof metaDefinition; events: {} }>({
      adapter: { invoke },
      metadata: { a: 1, b: 1 },
      hooks: {
        onInvoke: [() => ({ metadata: { b: 2, c: 2 } }), () => ({ metadata: { c: 3, d: 3 } })],
      },
    });

    await client.invoke.noParams();

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { a: 1, b: 2, c: 3, d: 3 },
      }),
    );
  });

  test('single object argument is treated as params without a runtime definition', async () => {
    const invoke = vi.fn((_call: any) => 'result');

    const client = ipcoraClient<{ handlers: typeof metaDefinition; events: {} }>({
      adapter: { invoke },
    });

    await (client.invoke.noParams as unknown as (value: unknown) => Promise<unknown>)({
      traceId: 'abc-123',
    });

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [{ traceId: 'abc-123' }],
      }),
    );
    const call = invoke.mock.calls[0]![0];
    expect(call).not.toHaveProperty('metadata');
  });

  test('per-call metadata on params route as second argument', async () => {
    const invoke = vi.fn(() => 'result');

    const client = ipcoraClient<{ handlers: typeof metaDefinition; events: {} }>({
      adapter: { invoke },
    });

    await client.invoke.withParams('bob', { tenant: 'acme' });

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['bob'],
        metadata: { tenant: 'acme' },
      }),
    );
  });

  test('calling without metadata passes undefined metadata', async () => {
    const invoke = vi.fn((_call: any) => 'result');

    const client = ipcoraClient<{ handlers: typeof metaDefinition; events: {} }>({
      adapter: { invoke },
    });

    await client.invoke.noParams();
    await client.invoke.withParams('eve');

    expect(invoke).toHaveBeenCalledTimes(2);
    for (const call of invoke.mock.calls) {
      expect(call[0]).not.toHaveProperty('metadata');
    }
  });

  test('non-object per-call arg is not treated as metadata', async () => {
    const invoke = vi.fn((_call: any) => 'result');

    const client = ipcoraClient<{ handlers: typeof metaDefinition; events: {} }>({
      adapter: { invoke },
    });

    await (client.invoke.noParams as unknown as (value: unknown) => Promise<unknown>)(
      'not-an-object',
    );

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['not-an-object'],
      }),
    );
    expect(invoke.mock.calls[0][0]).not.toHaveProperty('metadata');
  });

  test('async hooks.onInvoke hook is supported', async () => {
    const invoke = vi.fn(() => 'result');

    const client = ipcoraClient<{ handlers: typeof metaDefinition; events: {} }>({
      adapter: { invoke },
      hooks: {
        onInvoke: [
          async call => {
            await Promise.resolve();
            return { metadata: { path: call.channel, async: true } };
          },
        ],
      },
    });

    await client.invoke.noParams();

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { path: 'noParams', async: true },
      }),
    );
  });

  test('default mode returns invoke errors as result objects', async () => {
    const error = { name: 'NOPE', message: 'Nope', data: { reason: 'test' } };
    const invoke = vi.fn(() => ({ error }));

    const client = ipcoraClient<{ handlers: typeof metaDefinition; events: {} }>({
      adapter: { invoke },
    });

    expectTypeOf(client.invoke.noParams()).toEqualTypeOf<Promise<{ data: string; error: null }>>();
    await expect(client.invoke.noParams()).resolves.toEqual({ data: null, error });
  });

  test('throwInvokeError false keeps result object type', async () => {
    const invoke = vi.fn(() => ({ data: 'ok' }));

    const client = ipcoraClient<{ handlers: typeof metaDefinition; events: {} }>({
      adapter: { invoke },
      throwInvokeError: false,
    });

    expectTypeOf(client.invoke.noParams()).toEqualTypeOf<Promise<{ data: string; error: null }>>();
    await expect(client.invoke.noParams()).resolves.toEqual({ data: 'ok', error: null });
  });

  test('throwInvokeError returns data directly on success', async () => {
    const invoke = vi.fn(() => ({ data: 'ok' }));

    const client = ipcoraClient<{ handlers: typeof metaDefinition; events: {} }>({
      adapter: { invoke },
      throwInvokeError: true,
    });

    expectTypeOf(client.invoke.noParams).toExtend<() => Promise<string>>();
    await expect(client.invoke.noParams()).resolves.toBe('ok');
  });

  test('throwInvokeError throws ClientIpcError for invoke errors', async () => {
    const invoke = vi.fn(() => ({
      error: {
        name: 'NOPE',
        message: 'Nope',
        data: { reason: 'test' },
        stack: 'NOPE stack',
      },
    }));

    const client = ipcoraClient<{ handlers: typeof metaDefinition; events: {} }>({
      adapter: { invoke },
      throwInvokeError: true,
    });

    await expect(client.invoke.noParams()).rejects.toMatchObject({
      name: 'NOPE',
      message: 'Nope',
      stack: 'NOPE stack',
    });
    await expect(client.invoke.noParams()).rejects.toBeInstanceOf(ClientIpcError);
  });
});

import { describe, expect, test } from 'vitest';

import { ipcora, fail } from '../..';
import { createCaller, createMemoryAdapter } from '../test';
import { schema } from './helpers';

describe('createMemoryAdapter', () => {
  test('returns a working adapter with all four methods and empty state', () => {
    const mem = createMemoryAdapter();

    expect(mem.adapter).toBeDefined();
    expect(mem.handlers).toBeInstanceOf(Map);
    expect(mem.emitted).toEqual([]);
    expect(mem.handlers.size).toBe(0);

    // listenerCount returns 0 for unknown channel
    expect(mem.adapter.listenerCount('test')).toBe(0);

    // removeHandler on unknown channel is a no-op
    expect(() => mem.adapter.removeHandler('test')).not.toThrow();
  });

  test('handle() registers and removeHandler() unregisters a handler', () => {
    const mem = createMemoryAdapter();
    const handler = async () => ({ data: 'ok' });

    mem.adapter.handle('ch:test', handler);
    expect(mem.handlers.size).toBe(1);
    expect(mem.adapter.listenerCount('ch:test')).toBe(1);

    mem.adapter.removeHandler('ch:test');
    expect(mem.handlers.size).toBe(0);
    expect(mem.adapter.listenerCount('ch:test')).toBe(0);
  });

  test('emit() logs to emitted array', () => {
    const mem = createMemoryAdapter();
    mem.adapter.emit('ch:event:ping', { id: 1 }, { msg: 'hello' });

    expect(mem.emitted).toHaveLength(1);
    expect(mem.emitted[0]).toEqual({
      channel: 'ch:event:ping',
      sender: { id: 1 },
      payload: { msg: 'hello' },
    });
  });
});

describe('createCaller', () => {
  test('invokes a simple handler and returns typed IpcResult', async () => {
    const ipc = ipcora().handler('ping', () => 'pong' as const);
    const caller = createCaller(ipc);

    const result = await caller.ping();
    expect(result).toEqual({ data: 'pong', error: null });
  });

  test('invokes a handler with params', async () => {
    const nameSchema = schema<{ name: string }>(value =>
      typeof (value as { name?: unknown })?.name === 'string'
        ? { value: value as { name: string } }
        : { issues: [{ message: 'Expected object with name' }] },
    );

    const ipc = ipcora<{ tenant: string }>()
      .decorate('tenant', 'acme')
      .handler('greet', ({ params, tenant }) => `Hello ${params.name} from ${tenant}`, {
        params: nameSchema,
      });
    const caller = createCaller(ipc);

    const result = await caller.greet({ name: 'Alice' });
    expect(result).toEqual({ data: 'Hello Alice from acme', error: null });
  });

  test('params schema validates input via the full lifecycle', async () => {
    const nameSchema = schema<string>(value =>
      typeof value === 'string' && value.length > 0
        ? { value }
        : { issues: [{ message: 'Expected non-empty string' }] },
    );

    const ipc = ipcora().handler('echo', ({ params }) => params, { params: nameSchema });
    const caller = createCaller(ipc);

    // Valid
    await expect(caller.echo('hello')).resolves.toEqual({
      data: 'hello',
      error: null,
    });

    // Invalid — validation error
    const err = await caller.echo(123 as unknown as string);
    expect(err.data).toBeNull();
    expect(err.error).toBeDefined();
    expect(err.error!.name).toBe('VALIDATION_ERROR');
  });

  test('returns errors in correct IpcResult shape', async () => {
    const ipc = ipcora().handler('fail', () => {
      throw fail('CUSTOM_ERROR', { message: 'Something went wrong' });
    });
    const caller = createCaller(ipc);

    const result = await caller.fail();
    expect(result.data).toBeNull();
    expect(result.error).toBeDefined();
    expect(result.error!.name).toBe('CUSTOM_ERROR');
    expect(result.error!.message).toBe('Something went wrong');
  });

  test('nested routes work (e.g., caller.user.create)', async () => {
    const createSchema = schema<{ name: string }>(value =>
      typeof (value as { name?: unknown })?.name === 'string'
        ? { value: value as { name: string } }
        : { issues: [{ message: 'Expected object with name' }] },
    );
    const getSchema = schema<{ id: string }>(value =>
      typeof (value as { id?: unknown })?.id === 'string'
        ? { value: value as { id: string } }
        : { issues: [{ message: 'Expected object with id' }] },
    );

    const ipc = ipcora()
      .handler('user.create', ({ params }) => `created ${params.name}`, {
        params: createSchema,
      })
      .handler('user.get', ({ params }) => `got ${params.id}`, {
        params: getSchema,
      });

    const caller = createCaller(ipc);

    const createResult = await caller.user.create({ name: 'Bob' });
    expect(createResult).toEqual({ data: 'created Bob', error: null });

    const getResult = await caller.user.get({ id: '42' });
    expect(getResult).toEqual({ data: 'got 42', error: null });
  });

  test('group routes work (e.g., caller.admin.stats)', async () => {
    const ipc = ipcora().group('admin', g => g.handler('stats', () => ({ users: 100 })));
    const caller = createCaller(ipc);

    const result = await caller.admin.stats();
    expect(result).toEqual({ data: { users: 100 }, error: null });
  });

  test('lifecycle hooks run during call (onBeforeHandle, onAfterHandle)', async () => {
    const trace: string[] = [];

    const ipc = ipcora()
      .onBeforeHandle(() => {
        trace.push('before');
      })
      .onAfterHandle(() => {
        trace.push('after');
      })
      .handler('ping', () => 'pong');

    const caller = createCaller(ipc);
    await caller.ping();

    expect(trace).toEqual(['before', 'after']);
  });

  test('decorated context is passed to handler', async () => {
    const ipc = ipcora<{ tenant: string }>()
      .decorate('tenant', 'acme-corp')
      .handler('whoami', ({ tenant }) => `tenant=${tenant}`);
    const caller = createCaller(ipc);

    const result = await caller.whoami();
    expect(result).toEqual({ data: 'tenant=acme-corp', error: null });
  });

  test('custom peer id is respected', async () => {
    const ipc = ipcora<{ peerId: number }>()
      .derive(({ peer }) => ({
        peerId: peer.sender.id,
      }))
      .handler('who', ({ peerId }) => `peer=${peerId}`);

    const caller = createCaller(ipc, {
      peer: { sender: { id: 42 } },
    });

    const result = await caller.who();
    expect(result).toEqual({ data: 'peer=42', error: null });
  });

  test('abstract router throws on createCaller', () => {
    // Abstract routers don't register handlers, so createCaller cannot install
    // an adapter. It should throw a descriptive error.
    const ipc = ipcora({ abstract: true }).handler('ping', () => 'pong');

    // createCaller calls bind() which installs adapter. But abstract routers
    // don't register routes, so dispatch wouldn't find them. Actually, the
    // adapter IS installed (installAdapter skips abstract for handle but not
    // for state tracking). Let's test that bind on abstract still works
    // for type-level purposes but dispatching returns HANDLER_NOT_FOUND.
    // Actually, abstract routers skip installAdapter entirely, so bind
    // sets up the peer but doesn't register the dispatch handler.
    // So memory.handlers will be empty.
    expect(() => createCaller(ipc)).toThrow('Ipcora test adapter not installed');
  });

  test('validates params with schema on nested path', async () => {
    const numSchema = schema<number>(value =>
      typeof value === 'number' ? { value } : { issues: [{ message: 'Expected number' }] },
    );

    const ipc = ipcora().group('math', g =>
      g.handler('double', ({ params }) => (params as number) * 2, {
        params: numSchema,
      }),
    );

    const caller = createCaller(ipc);
    await expect(caller.math.double(21)).resolves.toEqual({
      data: 42,
      error: null,
    });
  });

  test('response schema validation works through createCaller', async () => {
    const numSchema = schema<number>(value =>
      typeof value === 'number' ? { value } : { issues: [{ message: 'Expected number' }] },
    );

    const ipc = ipcora().handler('num', () => 42, {
      response: numSchema,
    });

    const caller = createCaller(ipc);
    const result = await caller.num();
    expect(result).toEqual({ data: 42, error: null });
  });

  test('root caller cannot be called directly', () => {
    const ipc = ipcora().handler('ping', () => 'pong');
    const caller = createCaller(ipc);

    // Proxy apply throws synchronously when path is empty
    expect(() => (caller as any)()).toThrow('The root test caller cannot be called directly');
  });

  test('returns error for non-existent handler', async () => {
    const ipc = ipcora();
    const caller = createCaller(ipc);

    // Accessing a path that doesn't exist returns a proxy that will
    // call dispatch with a non-existent path → HANDLER_NOT_FOUND
    const result = await (caller as any).nope();
    expect(result.data).toBeNull();
    expect(result.error).toBeDefined();
    expect(result.error!.name).toBe('HANDLER_NOT_FOUND');
  });

  test('type inference: callers produce IpcResult shape', async () => {
    const ipc = ipcora().handler('ping', () => 'pong' as const);
    const caller = createCaller(ipc);

    const result = await caller.ping();
    // Verify the data branch is typed correctly at runtime
    expect(result.data).toBe('pong');
    expect(result.error).toBeNull();
  });

  test('metadata can be passed as last argument', async () => {
    const received: unknown[] = [];
    const logSchema = schema<{ msg: string }>(value =>
      typeof (value as { msg?: unknown })?.msg === 'string'
        ? { value: value as { msg: string } }
        : { issues: [{ message: 'Expected object with msg' }] },
    );

    const ipc = ipcora()
      .onInvoke(({ invoke, rawParams }) => {
        received.push({ id: invoke.id, metadata: invoke.metadata, rawParams });
      })
      .handler('log', ({ params }) => `logged ${params.msg}`, {
        params: logSchema,
      });

    const caller = createCaller(ipc);
    const result = await caller.log({ msg: 'hi' }, { traceId: 'abc' });

    expect(result).toEqual({ data: 'logged hi', error: null });
    expect(received).toHaveLength(1);
    expect((received[0] as any).metadata).toEqual({ traceId: 'abc' });
    expect((received[0] as any).rawParams).toEqual({ msg: 'hi' });
  });
});

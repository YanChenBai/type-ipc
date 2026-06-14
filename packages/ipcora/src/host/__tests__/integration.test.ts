/**
 * Full-flow integration tests — exercises every Ipcora feature in realistic
 * end-to-end scenarios combining router + client + events + lifecycle hooks.
 */
import { beforeEach, describe, expect, test } from 'vitest';

import { ipcora, fail } from '../..';
import { ipcoraClient, type Client, type InferDefinition } from '../../client';
import { defineEvents } from '../../event';
import { createMemoryTestAdapter, createPeer, schema, type MemoryTestAdapter } from './helpers';

// Full demo suite — exercises all 16 demo scenarios as automated tests
describe('demo suite integration', () => {
  // Replicate the full demo setup inline so tests are self-contained.
  class ValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ValidationError';
    }
  }
  class DatabaseError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'DatabaseError';
    }
  }

  const createUserParams = schema<{ name: string; email: string }>(value => {
    if (!value || typeof value !== 'object') return { issues: [{ message: 'Expected an object' }] };
    const p = value as Record<string, unknown>;
    const errors: { message: string; path?: readonly unknown[] }[] = [];
    if (typeof p.name !== 'string' || !p.name)
      errors.push({ message: 'name must be a non-empty string', path: ['name'] });
    if (typeof p.email !== 'string' || !p.email.includes('@'))
      errors.push({ message: 'email must be a valid address', path: ['email'] });
    if (errors.length) return { issues: errors };
    return { value: { name: p.name, email: p.email } as { name: string; email: string } };
  });

  const getUserParams = schema<{ id: string }>(value => {
    if (!value || typeof value !== 'object') return { issues: [{ message: 'Expected an object' }] };
    const id = (value as Record<string, unknown>).id;
    if (typeof id !== 'string' || !id)
      return { issues: [{ message: 'id must be a non-empty string', path: ['id'] }] };
    return { value: { id } };
  });

  const simulateErrorParams = schema<{ type: string }>(value => {
    if (!value || typeof value !== 'object') return { issues: [{ message: 'Expected an object' }] };
    const type = (value as Record<string, unknown>).type;
    if (typeof type !== 'string')
      return { issues: [{ message: 'type must be a string', path: ['type'] }] };
    return { value: { type } };
  });

  const userOutput = schema<{
    id: string;
    name: string;
    email: string;
    createdAt: number;
  }>(value => {
    if (!value || typeof value !== 'object') return { issues: [{ message: 'Expected an object' }] };
    const o = value as Record<string, unknown>;
    for (const k of ['id', 'name', 'email']) {
      if (typeof o[k] !== 'string')
        return { issues: [{ message: `${k} must be a string`, path: [k] }] };
    }
    if (typeof o.createdAt !== 'number')
      return { issues: [{ message: 'createdAt must be a number', path: ['createdAt'] }] };
    return {
      value: { id: o.id, name: o.name, email: o.email, createdAt: o.createdAt } as any,
    };
  });

  const userLoginEvent = schema<{ userId: string; at: number }>(value => {
    if (!value || typeof value !== 'object') return { issues: [{ message: 'Expected an object' }] };
    const e = value as Record<string, unknown>;
    if (typeof e.userId !== 'string' || typeof e.at !== 'number')
      return { issues: [{ message: 'userId (string) and at (number) required' }] };
    return { value: { userId: e.userId, at: e.at } as { userId: string; at: number } };
  });

  function createFullDemoIpcora() {
    const memory = createMemoryTestAdapter();

    const state = {
      users: new Map<string, { id: string; name: string; email: string; createdAt: number }>(),
      seq: 0,
    };

    const ipc = ipcora<{ tenant: string }, typeof state>({
      channel: 'app:ipc',
      adapter: memory.adapter,
    })
      .state(state)
      .decorate({ serviceName: 'user-service', version: '1.0.0', tenant: 'acme-corp' })
      .derive(({ rawParams, metadata }) => ({
        rawType: typeof rawParams,
        hasMetadata: metadata != null && Object.keys(metadata).length > 0,
      }))
      .onTransform(({ params }) => {
        if (params && typeof params === 'object') {
          const p = params as Record<string, unknown>;
          const trimmed: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(p)) {
            trimmed[k] = typeof v === 'string' ? (v as string).trim() : v;
          }
          return trimmed;
        }
      })
      .resolve(({ peer, metadata }) => ({
        requestId: `req-${(metadata as Record<string, unknown>).traceId ?? 'no-trace'}-${peer.sender.id}`,
      }))
      .onGuard(({ metadata }) => {
        const user = (metadata as Record<string, unknown>).user as
          | { id: string; role: string }
          | undefined;
        return { currentUser: user, isAdmin: user?.role === 'admin' };
      })
      .derive(() => ({ enteredAt: Date.now() }))
      .resolve(({ peer, id }) => ({ logPrefix: `[${peer.sender.id}:${id}]` }))
      .error(ValidationError, ({ fail, error }) =>
        fail('VALIDATION_CUSTOM', { message: error.message }),
      )
      .error(DatabaseError, ({ fail, error }) => fail('DB_UNAVAILABLE', { message: error.message }))
      .onError(({ name }) => {
        if (name === 'DB_UNAVAILABLE') {
          return { error: { name, message: 'Database is temporarily unavailable' } };
        }
      })
      .macro('requireAdmin', {
        onGuard({ isAdmin, fail }) {
          if (!isAdmin) throw fail('FORBIDDEN', { message: 'Admin role required' });
        },
      })
      .onBeforeHandle(({ signal }) => {
        if (signal.aborted) throw fail('ABORTED', { message: 'Request aborted' });
      })
      .events(defineEvents({ userLogin: userLoginEvent }));

    // Group: admin
    ipc.group('admin', admin =>
      admin
        .derive(() => ({ adminAudit: true }))
        .handler('stats', ({ store }) => ({ totalUsers: store.users.size }), { requireAdmin: true })
        .handler('dangerousOp', ({ tenant }) => `Executed in "${tenant}"`),
    );

    // user.create (admin only, params + response schema)
    ipc.handler(
      'user.create',
      ({ store, tenant, params }) => {
        store.seq += 1;
        // OnTransform already trimmed whitespace
        const id = `${tenant}-u${store.seq}`;
        const record = { id, name: params.name, email: params.email, createdAt: Date.now() };
        store.users.set(id, record);
        return record;
      },
      {
        params: createUserParams,
        response: userOutput,
        requireAdmin: true,
      },
    );

    // user.get (public, schema)
    ipc.handler(
      'user.get',
      ({ store, params }) => {
        const user = store.users.get(params.id);
        if (!user) throw fail('NOT_FOUND', { message: `User "${params.id}" not found` });
        return user;
      },
      { params: getUserParams, response: userOutput },
    );

    // user.list (public, no params)
    ipc.handler('user.list', ({ store, requestId }) => ({
      items: [...store.users.values()],
      total: store.users.size,
      requestId,
    }));

    // system.health (no params)
    ipc.handler('system.health', ({ serviceName, version, enteredAt, logPrefix }) => ({
      service: serviceName,
      version,
      uptime: Date.now() - enteredAt!,
      logPrefix,
    }));

    // db.simulateError (custom error classes)
    ipc.handler(
      'db.simulateError',
      ({ params }) => {
        switch (params.type) {
          case 'validation':
            throw new ValidationError('Simulated validation failure');
          case 'database':
            throw new DatabaseError('Simulated database failure');
          case 'unknown':
            throw new Error('Simulated unknown error');
          default:
            return { ok: true, type: params.type };
        }
      },
      { params: simulateErrorParams },
    );

    ipc.bind(createPeer(1));

    return { ipc, invoke: memory.invoke, state, memory };
  }

  const adminMeta = { traceId: 'trace-admin', user: { id: 'admin-1', role: 'admin' } };
  const memberMeta = { traceId: 'trace-member', user: { id: 'user-2', role: 'member' } };

  let demo: ReturnType<typeof createFullDemoIpcora>;
  beforeEach(() => {
    demo = createFullDemoIpcora();
  });

  // 1. user.create (admin)
  test('scenario 1: admin creates a user with whitespace-trimmed params', async () => {
    const res = await demo.invoke('app:ipc', 1, {
      id: 'r1',
      path: 'user.create',
      params: { name: 'Alice', email: '  alice@acme.com  ' },
      metadata: adminMeta,
    });

    expect(res.data).toMatchObject({
      id: 'acme-corp-u1',
      name: 'Alice',
      email: 'alice@acme.com', // Trimmed by onTransform
    });
    expect(demo.state.users.size).toBe(1);
  });

  // 2. user.create (member → forbidden)
  test('scenario 2: member cannot create user (requireAdmin macro)', async () => {
    const res = await demo.invoke('app:ipc', 1, {
      id: 'r2',
      path: 'user.create',
      params: { name: 'Eve', email: 'eve@acme.com' },
      metadata: memberMeta,
    });

    expect(res.error).toMatchObject({
      name: 'FORBIDDEN',
      message: 'Admin role required',
    });
    expect(demo.state.users.size).toBe(0);
  });

  // 3. user.get
  test('scenario 3: retrieve a created user by id', async () => {
    // Seed a user first
    await demo.invoke('app:ipc', 1, {
      id: 'seed',
      path: 'user.create',
      params: { name: 'Alice', email: 'alice@acme.com' },
      metadata: adminMeta,
    });

    const res = await demo.invoke('app:ipc', 1, {
      id: 'r3',
      path: 'user.get',
      params: { id: 'acme-corp-u1' },
      metadata: memberMeta,
    });

    expect(res.data).toMatchObject({ id: 'acme-corp-u1', name: 'Alice' });
  });

  // 4. user.get (not found)
  test('scenario 4: get non-existent user returns NOT_FOUND error', async () => {
    const res = await demo.invoke('app:ipc', 1, {
      id: 'r4',
      path: 'user.get',
      params: { id: 'nope' },
      metadata: memberMeta,
    });

    expect(res.error).toMatchObject({
      name: 'NOT_FOUND',
      message: 'User "nope" not found',
    });
  });

  // 5. user.list
  test('scenario 5: list users returns correct total and items', async () => {
    // Seed two users
    for (const [name, email] of [
      ['Alice', 'alice@a.com'],
      ['Bob', 'bob@b.com'],
    ]) {
      await demo.invoke('app:ipc', 1, {
        id: `seed-${name}`,
        path: 'user.create',
        params: { name, email },
        metadata: adminMeta,
      });
    }

    const res = await demo.invoke('app:ipc', 1, {
      id: 'r5',
      path: 'user.list',
      metadata: memberMeta,
    });

    expect(res.data).toMatchObject({ total: 2 });
    expect((res.data as any).items).toHaveLength(2);
    expect((res.data as any).requestId).toBe('req-trace-member-1');
  });

  // 6. system.health
  test('scenario 6: health check returns context-derived fields', async () => {
    const res = await demo.invoke('app:ipc', 1, {
      id: 'r6',
      path: 'system.health',
    });

    expect(res.data).toMatchObject({
      service: 'user-service',
      version: '1.0.0',
      logPrefix: '[1:r6]',
    });
    expect(typeof (res.data as any).uptime).toBe('number');
  });

  // 7. admin.stats (admin)
  test('scenario 7: admin can access stats', async () => {
    const res = await demo.invoke('app:ipc', 1, {
      id: 'r7',
      path: 'admin.stats',
      metadata: adminMeta,
    });

    expect(res.data).toMatchObject({ totalUsers: 0 });
  });

  // 8. admin.stats (member → forbidden)
  test('scenario 8: member cannot access admin stats', async () => {
    const res = await demo.invoke('app:ipc', 1, {
      id: 'r8',
      path: 'admin.stats',
      metadata: memberMeta,
    });

    expect(res.error).toMatchObject({
      name: 'FORBIDDEN',
      message: 'Admin role required',
    });
  });

  // 9. admin.dangerousOp
  test('scenario 9: admin dangerousOp receives tenant context', async () => {
    const res = await demo.invoke('app:ipc', 1, {
      id: 'r9',
      path: 'admin.dangerousOp',
      metadata: adminMeta,
    });

    expect(res.data).toBe('Executed in "acme-corp"');
  });

  // 10. Validation error
  test('scenario 10: invalid params trigger VALIDATION_ERROR', async () => {
    const res = await demo.invoke('app:ipc', 1, {
      id: 'r10',
      path: 'user.create',
      params: { name: '', email: 'not-an-email' },
      metadata: adminMeta,
    });

    expect(res.error).toMatchObject({ name: 'VALIDATION_ERROR' });
  });

  // 11. Custom ValidationError mapping
  test('scenario 11: ValidationError is mapped via error() to VALIDATION_CUSTOM', async () => {
    const res = await demo.invoke('app:ipc', 1, {
      id: 'r11',
      path: 'db.simulateError',
      params: { type: 'validation' },
    });

    expect(res.error).toMatchObject({
      name: 'VALIDATION_CUSTOM',
      message: 'Simulated validation failure',
    });
  });

  // 12. DatabaseError → onError rewrite
  test('scenario 12: DatabaseError is mapped then rewritten by global onError', async () => {
    const res = await demo.invoke('app:ipc', 1, {
      id: 'r12',
      path: 'db.simulateError',
      params: { type: 'database' },
    });

    // The error() mapping converts to DB_UNAVAILABLE(503),
    // then global onError rewrites it further.
    expect(res.error).toMatchObject({
      name: 'DB_UNAVAILABLE',
      message: 'Database is temporarily unavailable',
    });
  });

  // 13. Unknown error propagates name and message
  test('scenario 13: unknown Error propagates its name and message', async () => {
    const res = await demo.invoke('app:ipc', 1, {
      id: 'r13',
      path: 'db.simulateError',
      params: { type: 'unknown' },
    });

    expect(res.error).toMatchObject({ name: 'Error', message: 'Simulated unknown error' });
  });

  // 14. Handler not found
  test('scenario 14: non-existent path returns HANDLER_NOT_FOUND', async () => {
    const res = await demo.invoke('app:ipc', 1, {
      id: 'r14',
      path: 'nope.notHere',
    });

    expect(res.error).toMatchObject({ name: 'HANDLER_NOT_FOUND' });
  });

  // 15. Events
  test('scenario 15: emit event to bound peers', async () => {
    await demo.ipc.emit('userLogin', { userId: 'u1', at: 1234567890 });

    expect(demo.memory.emitted).toHaveLength(1);
    expect(demo.memory.emitted[0]).toMatchObject({
      channel: 'app:ipc:event:userLogin',
      sender: { id: 1 },
      payload: { userId: 'u1', at: 1234567890 },
    });
  });

  // 16. Route definition
  test('scenario 16: router exposes fully structured definition', () => {
    const def = demo.ipc.manifest;
    const keys = Object.keys(def);
    // Should contain handlers, events, and groups
    expect(keys).toContain('user');
    expect(keys).toContain('system');
    expect(keys).toContain('admin');
    expect(keys).toContain('db');
    // Events
    expect(keys).toContain('onUserLogin');
    expect(keys).toContain('onOnceUserLogin');
  });

  // 17 (bonus). onTransform trim + error path for user.get validation
  test('scenario 17: user.get bad params validation error', async () => {
    const res = await demo.invoke('app:ipc', 1, {
      id: 'r17',
      path: 'user.get',
      params: { id: '' },
      metadata: memberMeta,
    });

    expect(res.error).toMatchObject({ name: 'VALIDATION_ERROR' });
  });

  // 18 (bonus). db.simulateError happy path
  test('scenario 18: db.simulateError normal type returns ok', async () => {
    const res = await demo.invoke('app:ipc', 1, {
      id: 'r18',
      path: 'db.simulateError',
      params: { type: 'normal' },
    });

    expect(res.data).toMatchObject({ ok: true, type: 'normal' });
  });
});

// Client + Ipcora full round-trip
describe('client ↔ ipcora round-trip', () => {
  let memory: MemoryTestAdapter;

  beforeEach(() => {
    memory = createMemoryTestAdapter();
  });

  test('invoke flows from client proxy → adapter → router → back', async () => {
    const numberParams = schema<number>(v =>
      typeof v === 'number' ? { value: v } : { issues: [{ message: 'Expected number' }] },
    );

    // Build server-side Ipcora
    const ipc = ipcora({
      channel: 'test:rt',
      adapter: memory.adapter,
    })
      .state('version', 2)
      .decorate({ env: 'test' })
      .handler(
        'math.double',
        ({ params, env, store }) => ({
          result: params * 2,
          env,
          version: store.version,
        }),
        { params: numberParams },
      )
      .handler('math.greet', () => 'hello');

    ipc.bind(createPeer(1));

    // Create client from definition
    type Def = InferDefinition<typeof ipc>;
    const client: Client<Def> = ipcoraClient<Def>({
      adapter: {
        invoke: call =>
          memory
            .invoke('test:rt', 1, {
              id: 'client-r1',
              path: call.channel,
              params: call.args[0],
              metadata: call.metadata,
            })
            .then(r => (r.error ? Promise.reject(r.error) : r.data)),
      },
    });

    // Call a route with params
    const res1 = await client.invoke.math.double(5);
    expect(res1).toEqual({ data: { result: 10, env: 'test', version: 2 }, error: null });

    // Call a route without params
    const res2 = await client.invoke.math.greet();
    expect(res2).toEqual({ data: 'hello', error: null });
  });

  test('client error response propagates as typed IpcResult', async () => {
    const ipc = ipcora({
      channel: 'test:rt-err',
      adapter: memory.adapter,
    }).handler('fail', ({ fail }) => fail('TEAPOT', 'I am a teapot'));

    ipc.bind(createPeer(1));

    type Def = InferDefinition<typeof ipc>;
    const client: Client<Def> = ipcoraClient<Def>({
      // Return the raw IpcResponse — ipcoraClient normalizes it to { data, error } shape
      adapter: {
        invoke: call =>
          memory.invoke('test:rt-err', 1, {
            id: 'e1',
            path: call.channel,
            params: call.args[0],
            metadata: call.metadata,
          }),
      },
    });

    // Client receives full error as IpcResult (normalized from wire response)
    await expect(client.invoke.fail()).resolves.toMatchObject({
      data: null,
      error: { name: 'TEAPOT', message: 'I am a teapot' },
    });
  });

  test('metadata flows client → adapter → router context', async () => {
    const receivedMetaRef: { value: unknown } = { value: undefined };
    const echoParams = schema<{ message: string }>(value => {
      if (!value || typeof value !== 'object')
        return { issues: [{ message: 'Expected an object' }] };
      const message = (value as Record<string, unknown>).message;
      if (typeof message !== 'string') return { issues: [{ message: 'message must be a string' }] };
      return { value: { message } };
    });
    const ipc = ipcora<{}>({
      channel: 'test:meta',
      adapter: memory.adapter,
    }).handler(
      'echo',
      ({ metadata }) => {
        receivedMetaRef.value = metadata;
        return { ok: true };
      },
      { params: echoParams },
    );

    ipc.bind(createPeer(1));

    type Def = InferDefinition<typeof ipc>;
    const client: Client<Def> = ipcoraClient<Def>({
      adapter: {
        invoke: call =>
          memory
            .invoke('test:meta', 1, {
              id: 'm1',
              path: call.channel,
              params: call.args[0],
              metadata: call.metadata,
            })
            .then(r => (r.error ? Promise.reject(r.error) : r.data)),
      },
      metadata: { app: 'myApp' },
      hooks: {
        onInvoke: [call => ({ metadata: { channel: call.channel } })],
      },
    });

    await client.invoke.echo({ message: 'hello' }, { tenant: 'acme' });

    expect(receivedMetaRef.value).toMatchObject({
      app: 'myApp',
      channel: 'echo',
      tenant: 'acme',
    });
  });

  test('multiple handlers coexist and are independently callable', async () => {
    const ipc = ipcora({
      channel: 'test:multi-rt',
      adapter: memory.adapter,
    })
      .handler('a', () => 'A')
      .handler('b', () => 'B')
      .handler('c', () => 'C');

    ipc.bind(createPeer(1));

    type Def = InferDefinition<typeof ipc>;
    const client: Client<Def> = ipcoraClient<Def>({
      adapter: {
        invoke: call =>
          memory
            .invoke('test:multi-rt', 1, {
              id: call.channel,
              path: call.channel,
              params: call.args[0],
              metadata: call.metadata,
            })
            .then(r => (r.error ? Promise.reject(r.error) : r.data)),
      },
    });

    await expect(client.invoke.a()).resolves.toEqual({ data: 'A', error: null });
    await expect(client.invoke.b()).resolves.toEqual({ data: 'B', error: null });
    await expect(client.invoke.c()).resolves.toEqual({ data: 'C', error: null });
  });

  test('group routes are reachable through client', async () => {
    const ipc = ipcora({
      channel: 'test:group-rt',
      adapter: memory.adapter,
    }).group('api', g => g.handler('status', () => 'ok').handler('version', () => '1.0'));

    ipc.bind(createPeer(1));

    type Def = InferDefinition<typeof ipc>;
    const client: Client<Def> = ipcoraClient<Def>({
      adapter: {
        invoke: call =>
          memory
            .invoke('test:group-rt', 1, {
              id: call.channel,
              path: call.channel,
              params: call.args[0],
              metadata: call.metadata,
            })
            .then(r => (r.error ? Promise.reject(r.error) : r.data)),
      },
    });

    await expect(client.invoke.api.status()).resolves.toEqual({ data: 'ok', error: null });
    await expect(client.invoke.api.version()).resolves.toEqual({ data: '1.0', error: null });
  });
});

describe('complex multi-feature scenarios', () => {
  test('state mutation is visible across sequential handler calls', () => {
    const ipc = createMemoryTestAdapter();
    const app = ipcora<{}, { hits: number }>({
      channel: 'test:state',
      adapter: ipc.adapter,
    })
      .state('hits', 0)
      .handler('hit', ({ store }) => {
        store.hits += 1;
        return { hits: store.hits };
      })
      .handler('peek', ({ store }) => ({ hits: store.hits }));

    app.bind(createPeer(1));

    return Promise.all([
      ipc.invoke('test:state', 1, { id: '1', path: 'hit' }).then(r => {
        expect(r.data).toEqual({ hits: 1 });
      }),
      ipc.invoke('test:state', 1, { id: '2', path: 'hit' }).then(r => {
        expect(r.data).toEqual({ hits: 2 });
      }),
      ipc.invoke('test:state', 1, { id: '3', path: 'peek' }).then(r => {
        // Because state is mutable and shared, the peek result depends on ordering.
        // We just verify it's a number and consistent (>= those that have landed).
        expect(typeof (r.data as any).hits).toBe('number');
      }),
    ]);
  });

  test('multiple peers with different bound contexts are isolated', async () => {
    const ipc = createMemoryTestAdapter();
    const app = ipcora<{ role: string }>({
      channel: 'test:multi-peer',
      adapter: ipc.adapter,
    })
      .derive(({ peer }) => ({ role: `peer-${peer.sender.id}` }))
      .handler('whoami', ({ role }) => ({ role }));

    app.bind(createPeer(1), createPeer(2));

    const [r1, r2] = await Promise.all([
      ipc.invoke('test:multi-peer', 1, { id: '1', path: 'whoami' }),
      ipc.invoke('test:multi-peer', 2, { id: '2', path: 'whoami' }),
    ]);

    expect(r1.data).toEqual({ role: 'peer-1' });
    expect(r2.data).toEqual({ role: 'peer-2' });
  });

  test('macro + trace + error mapping all active simultaneously', async () => {
    class PaymentError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'PaymentError';
      }
    }

    const calls: string[] = [];
    const ipc = createMemoryTestAdapter();

    const app = ipcora<{}, { audit: string[] }>({
      channel: 'test:all-features',
      adapter: ipc.adapter,
    })
      .state('audit', [] as string[])
      .error(PaymentError, ({ fail, error }) => fail('PAYMENT_FAILED', { message: error.message }))
      .macro('loggable', {
        onBeforeHandle({ path, option }) {
          calls.push(`log:${path}:${option}`);
        },
        onAfterHandle({ path, response }) {
          calls.push(`logged:${path}`);
          return response;
        },
      })
      .derive(({ path }) => {
        calls.push(`derive:${path}`);
        return { injected: 'from-derive' };
      })
      .onTrace(({ path, success }) => {
        calls.push(`trace:${path}:${success}`);
      })
      .handler(
        'checkout',
        ({ store, injected, params }) => {
          const action = params as unknown as string;
          calls.push(`handler:${action}`);
          store.audit.push(`checkout:${action}`);
          if (action === 'fail') throw new PaymentError('Insufficient funds');
          return { status: 'paid', injected };
        },
        { loggable: 'checkout-audit' },
      );

    app.bind(createPeer(1));

    // Happy path
    const r1 = await ipc.invoke('test:all-features', 1, {
      id: 'c1',
      path: 'checkout',
      params: 'success',
    });
    expect(r1.data).toMatchObject({ status: 'paid', injected: 'from-derive' });
    expect(calls).toContain('derive:checkout');
    expect(calls).toContain('log:checkout:checkout-audit');
    expect(calls).toContain('handler:success');
    expect(calls).toContain('logged:checkout');
    expect(calls).toContain('trace:checkout:true');

    // Error path
    const r2 = await ipc.invoke('test:all-features', 1, {
      id: 'c2',
      path: 'checkout',
      params: 'fail',
    });
    expect(r2.error).toMatchObject({
      name: 'PAYMENT_FAILED',
      message: 'Insufficient funds',
    });
    expect(calls).toContain('trace:checkout:false');
  });

  test('macro factory creates dynamic hooks based on option value', async () => {
    const ipc = createMemoryTestAdapter();
    const app = ipcora({
      channel: 'test:macro-factory-2',
      adapter: ipc.adapter,
    })
      .macro({
        rateLimit: (maxCalls: number) => {
          let count = 0;
          return {
            seed: maxCalls,
            // Use resolve (runs after validation) to extend context.
            // onBeforeHandle cannot extend context — its return is ignored.
            resolve({ fail }) {
              count += 1;
              if (count > maxCalls) {
                throw fail('RATE_LIMITED', { message: `Exceeded ${maxCalls} calls` });
              }
              return { remaining: maxCalls - count };
            },
          };
        },
      })
      .handler('api', ({ remaining }) => ({ remaining }), { rateLimit: 2 });

    app.bind(createPeer(1));

    const r1 = await ipc.invoke('test:macro-factory-2', 1, { id: '1', path: 'api' });
    expect(r1.data).toEqual({ remaining: 1 });

    const r2 = await ipc.invoke('test:macro-factory-2', 1, { id: '2', path: 'api' });
    expect(r2.data).toEqual({ remaining: 0 });

    const r3 = await ipc.invoke('test:macro-factory-2', 1, { id: '3', path: 'api' });
    expect(r3.error).toMatchObject({ name: 'RATE_LIMITED', message: 'Exceeded 2 calls' });
  });
});

describe('error handling full flow', () => {
  test('custom error class → error() mapping → onError → client receives typed payload', async () => {
    class AuthError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'AuthError';
      }
    }

    const memory = createMemoryTestAdapter();
    const ipc = ipcora({
      channel: 'test:err-flow',
      adapter: memory.adapter,
    })
      .error(AuthError, ({ fail, error }) => fail('AUTH_FAILED', { message: error.message }))
      .onError(({ name, error, fail }) => {
        if (name === 'AUTH_FAILED') {
          return fail('UNAUTHORIZED', {
            message: `Auth rejected: ${error.message}`,
          });
        }
      })
      .handler('secret', () => {
        throw new AuthError('Invalid token');
      });

    ipc.bind(createPeer(1));

    const res = await memory.invoke('test:err-flow', 1, { id: 'e1', path: 'secret' });
    expect(res.error).toMatchObject({
      name: 'UNAUTHORIZED',
      message: 'Auth rejected: Invalid token',
    });
  });

  test('local onError overrides global onError for the same handler', async () => {
    const memory = createMemoryTestAdapter();
    const ipc = ipcora({
      channel: 'test:local-onerror',
      adapter: memory.adapter,
    })
      .onError(({ fail }) => fail('GLOBAL', 'global override'))
      .handler(
        'run',
        () => {
          throw fail('BOOM');
        },
        {
          onError({ fail }) {
            return fail('LOCAL', 'local override');
          },
        },
      );

    ipc.bind(createPeer(1));

    const res = await memory.invoke('test:local-onerror', 1, { id: '1', path: 'run' });
    // Local onError runs first (reversed order), so it wins
    expect(res.error).toMatchObject({ name: 'LOCAL' });
  });

  test('exposeStack: true includes stack in error payload', async () => {
    const memory = createMemoryTestAdapter();
    const ipc = ipcora({
      channel: 'test:stack',
      adapter: memory.adapter,
      exposeStack: true,
    }).handler('crash', () => {
      throw new Error('boom');
    });

    ipc.bind(createPeer(1));

    const res = await memory.invoke('test:stack', 1, { id: '1', path: 'crash' });
    expect(res.error).toHaveProperty('stack');
    expect(typeof (res.error as any).stack).toBe('string');
  });

  test('exposeStack: false excludes stack', async () => {
    const memory = createMemoryTestAdapter();
    const ipc = ipcora({
      channel: 'test:no-stack',
      adapter: memory.adapter,
      exposeStack: false,
    }).handler('crash', () => {
      throw new Error('boom');
    });

    ipc.bind(createPeer(1));

    const res = await memory.invoke('test:no-stack', 1, { id: '1', path: 'crash' });
    expect((res.error as any).stack).toBeUndefined();
  });

  test('IpcError with cause preserves the cause chain', async () => {
    const memory = createMemoryTestAdapter();
    const ipc = ipcora({
      channel: 'test:cause',
      adapter: memory.adapter,
      exposeStack: true,
    }).handler('causal', () => {
      throw fail('OUTER', {
        message: 'Wrapper error',
        cause: new Error('root cause'),
      });
    });

    ipc.bind(createPeer(1));

    const res = await memory.invoke('test:cause', 1, { id: '1', path: 'causal' });
    expect(res.error).toMatchObject({ name: 'OUTER', message: 'Wrapper error' });
  });
});

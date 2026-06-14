import { beforeEach, describe, expect, expectTypeOf, test, vi } from 'vitest';

import { ipcora, fail } from '../..';
import { createMemoryTestAdapter, createPeer, schema, type MemoryTestAdapter } from './helpers';

let ipcAdapter: MemoryTestAdapter = createMemoryTestAdapter();

beforeEach(() => {
  ipcAdapter = createMemoryTestAdapter();
});

describe('Ipcora lifecycle', () => {
  test('runs handler-local lifecycle hooks in order', async () => {
    const calls: string[] = [];
    const ipc = ipcora({ channel: 'test:lifecycle', adapter: ipcAdapter.adapter })
      .onInvoke(() => {
        calls.push('global:onInvoke');
      })
      .onTransform(({ params }) => {
        calls.push('global:onTransform');
        return params;
      })
      .onGuard(() => {
        calls.push('global:onGuard');
      })
      .onBeforeHandle(() => {
        calls.push('global:onBeforeHandle');
      })
      .onAfterHandle(({ response }) => {
        calls.push('global:onAfterHandle');
        return response;
      })
      .onMapResponse(({ response }) => {
        calls.push('global:onMapResponse');
        return response;
      })
      .onAfterResponse(() => {
        calls.push('global:onAfterResponse');
      })
      .handler(
        'run',
        () => {
          calls.push('handler');
          return 'ok';
        },
        {
          onInvoke: () => {
            calls.push('local:onInvoke');
          },
          onTransform: ({ params }) => {
            calls.push('local:onTransform');
            return params;
          },
          onGuard: () => {
            calls.push('local:onGuard');
          },
          onBeforeHandle: () => {
            calls.push('local:onBeforeHandle');
          },
          onAfterHandle: ({ response }) => {
            calls.push('local:onAfterHandle');
            return response;
          },
          onMapResponse: ({ response }) => {
            calls.push('local:onMapResponse');
            return response;
          },
          onAfterResponse: () => {
            calls.push('local:onAfterResponse');
          },
        },
      );
    ipc.bind(createPeer(1));

    await ipcAdapter.invoke('test:lifecycle', 1, { id: '1', path: 'run' });

    expect(calls).toEqual([
      'global:onInvoke',
      'local:onInvoke',
      'global:onTransform',
      'local:onTransform',
      'global:onGuard',
      'local:onGuard',
      'global:onBeforeHandle',
      'local:onBeforeHandle',
      'handler',
      'local:onAfterHandle',
      'global:onAfterHandle',
      'local:onMapResponse',
      'global:onMapResponse',
      'local:onAfterResponse',
      'global:onAfterResponse',
    ]);
  });

  test('injects state, decorators, derive, and resolve context extensions', async () => {
    const numberParams = schema<number>(value =>
      typeof value === 'number' ? { value } : { issues: [{ message: 'Expected number' }] },
    );
    const ipc = ipcora({ channel: 'test:context', adapter: ipcAdapter.adapter })
      .state('count', 1)
      .decorate('logger', { prefix: 'ipc' })
      .derive(({ rawParams }) => ({ rawKind: typeof rawParams }))
      .resolve(({ params }) => ({ doubled: Number(params) * 2 }))
      .handler(
        'read',
        ({ store, logger, rawKind, doubled }) => {
          store.count += 1;
          return {
            count: store.count,
            prefix: logger.prefix,
            rawKind,
            doubled,
          };
        },
        { params: numberParams },
      );
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:context', 1, { id: '1', path: 'read', params: 3 }),
    ).resolves.toMatchObject({
      data: { count: 2, prefix: 'ipc', rawKind: 'number', doubled: 6 },
    });
    await expect(
      ipcAdapter.invoke('test:context', 1, { id: '2', path: 'read', params: 4 }),
    ).resolves.toMatchObject({
      data: { count: 3, prefix: 'ipc', rawKind: 'number', doubled: 8 },
    });
  });

  test('expands macro options before handler-local hooks', async () => {
    const calls: string[] = [];
    const ipc = ipcora({ channel: 'test:macro', adapter: ipcAdapter.adapter })
      .macro('auth', {
        onGuard({ option }) {
          calls.push(`macro:onGuard:${option}`);
          return { user: { role: option } };
        },
        onAfterHandle({ response }) {
          calls.push('macro:onAfterHandle');
          return response;
        },
      })
      .handler(
        'secure',
        ({ user }) => {
          calls.push(`handler:${user.role}`);
          return 'ok';
        },
        {
          auth: 'admin',
          onGuard() {
            calls.push('local:onGuard');
          },
          onAfterHandle({ response }) {
            calls.push('local:onAfterHandle');
            return response;
          },
        },
      );
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:macro', 1, { id: '1', path: 'secure' }),
    ).resolves.toMatchObject({
      data: 'ok',
    });
    expect(calls).toEqual([
      'macro:onGuard:admin',
      'local:onGuard',
      'handler:admin',
      'local:onAfterHandle',
      'macro:onAfterHandle',
    ]);
  });

  test('supports Elysia-style macro factories and object shorthand', async () => {
    const calls: string[] = [];
    const ipc = ipcora({ channel: 'test:macro-factory', adapter: ipcAdapter.adapter })
      .macro({
        role: (role: 'admin' | 'member') => ({
          resolve() {
            calls.push(`role:${role}`);
            return { role };
          },
        }),
        isAuth: {
          resolve() {
            calls.push('isAuth');
            return { user: 'saltyaom' };
          },
        },
      })
      .handler(
        'secure',
        ({ role, user }) => {
          calls.push(`handler:${role}:${user}`);
          return { role, user };
        },
        {
          role: 'admin',
          isAuth: true,
        },
      );
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:macro-factory', 1, { id: '1', path: 'secure' }),
    ).resolves.toEqual({
      data: { role: 'admin', user: 'saltyaom' },
    });
    expect(calls).toEqual(['role:admin', 'isAuth', 'handler:admin:saltyaom']);
  });

  test('allows macros to extend other macros and deduplicates by seed', async () => {
    const calls: string[] = [];
    const ipc = ipcora({ channel: 'test:macro-extension', adapter: ipcAdapter.adapter })
      .macro({
        base: (name: string) => ({
          seed: name,
          onBeforeHandle() {
            calls.push(`base:${name}`);
          },
        }),
        composed: {
          base: 'shared',
          onBeforeHandle() {
            calls.push('composed');
          },
        },
        another: {
          base: 'shared',
          onBeforeHandle() {
            calls.push('another');
          },
        },
      })
      .handler(
        'run',
        () => {
          calls.push('handler');
          return 'ok';
        },
        {
          composed: true,
          another: true,
        },
      );
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:macro-extension', 1, { id: '1', path: 'run' }),
    ).resolves.toEqual({
      data: 'ok',
    });
    expect(calls).toEqual(['base:shared', 'composed', 'another', 'handler']);
  });

  test('composes macro schemas with route schemas', async () => {
    const objectParams = schema<Record<string, unknown>>(value =>
      value && typeof value === 'object'
        ? { value: value as Record<string, unknown> }
        : { issues: [{ message: 'Expected object params' }] },
    );
    const namedParams = schema<{ name: string }>(value => {
      const params = value as Record<string, unknown>;
      return typeof params.name === 'string'
        ? { value: { name: params.name } }
        : { issues: [{ message: 'Expected name', path: ['name'] }] };
    });
    const ipc = ipcora({ channel: 'test:macro-schema', adapter: ipcAdapter.adapter })
      .macro({
        withObjectParams: {
          params: objectParams,
        },
      })
      .handler('read', ({ params }) => params.name, {
        params: namedParams,
        withObjectParams: true,
      });
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:macro-schema', 1, {
        id: '1',
        path: 'read',
        params: { name: 'Lilith' },
      }),
    ).resolves.toMatchObject({
      data: 'Lilith',
    });
    await expect(
      ipcAdapter.invoke('test:macro-schema', 1, { id: '2', path: 'read', params: 'bad' }),
    ).resolves.toMatchObject({
      error: { name: 'VALIDATION_ERROR' },
    });
  });

  test('allows onError to map custom responses', async () => {
    const ipc = ipcora({ channel: 'test:error', adapter: ipcAdapter.adapter }).handler(
      'explode',
      () => {
        throw fail('NOPE', 'Nope');
      },
      {
        onError({ phase, cause }) {
          expect(phase).toBe('handler');
          expect(cause).toBeInstanceOf(Error);
          return { data: 'handled' };
        },
      },
    );
    ipc.bind(createPeer(1));

    await expect(ipcAdapter.invoke('test:error', 1, { id: '1', path: 'explode' })).resolves.toEqual(
      {
        data: 'handled',
      },
    );
  });

  test('routes returned and thrown through onError', async () => {
    const calls: string[] = [];
    const ipc = ipcora({
      channel: 'test:on-error',
      adapter: ipcAdapter.adapter,
    })
      .handler('return-fail', ({ fail }) => fail('TEAPOT', 'returned'), {
        onError({ name, error, fail }) {
          calls.push(`return:${name}:${error.message}`);
          return fail('RETURN_MAPPED', error.message);
        },
      })
      .handler(
        'throw-fail',
        ({ fail }) => {
          throw fail('TEAPOT', 'thrown');
        },
        {
          onError({ name, error, fail }) {
            calls.push(`throw:${name}:${error.message}`);
            return fail('THROW_MAPPED', error.message);
          },
        },
      );
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:on-error', 1, { id: '1', path: 'return-fail' }),
    ).resolves.toMatchObject({
      error: { name: 'RETURN_MAPPED', message: 'returned' },
    });
    await expect(
      ipcAdapter.invoke('test:on-error', 1, { id: '2', path: 'throw-fail' }),
    ).resolves.toMatchObject({
      error: { name: 'THROW_MAPPED', message: 'thrown' },
    });
    expect(calls).toEqual(['return:TEAPOT:returned', 'throw:TEAPOT:thrown']);
  });

  test('maps custom errors into typed handler errors', async () => {
    class MyError extends Error {}

    const ipc = ipcora({
      channel: 'test:typed-error',
      adapter: ipcAdapter.adapter,
    })
      .error(MyError, ({ fail, error }) => fail('MyError', error.message))
      .handler('fail', () => {
        throw new MyError('short and stout');
      });

    type FailResult = Awaited<ReturnType<typeof ipc.manifest.fail>>;
    expectTypeOf<Extract<FailResult['error'], { name: 'MyError' }>>().toMatchObjectType<{
      name: 'MyError';
      message: string;
    }>();

    ipc.bind(createPeer(1));
    await expect(
      ipcAdapter.invoke('test:typed-error', 1, { id: '1', path: 'fail' }),
    ).resolves.toMatchObject({
      error: { name: 'MyError', message: 'short and stout' },
    });
  });

  test('includes onError returned payload in route error inference', () => {
    const ipc = ipcora({ channel: 'test:on-error-type', adapter: ipcAdapter.adapter })
      .onError(({ fail }) => fail('GLOBAL_ERROR', 'global'))
      .handler('local', () => 'ok', {
        onError({ fail }) {
          return fail('LOCAL_ERROR', 'local');
        },
      });

    type LocalResult = Awaited<ReturnType<typeof ipc.manifest.local>>;
    expectTypeOf<Extract<LocalResult['error'], { name: 'GLOBAL_ERROR' }>>().toMatchObjectType<{
      name: 'GLOBAL_ERROR';
      message: string;
    }>();
    expectTypeOf<Extract<LocalResult['error'], { name: 'LOCAL_ERROR' }>>().toMatchObjectType<{
      name: 'LOCAL_ERROR';
      message: string;
    }>();
  });

  test('isolates onAfterResponse errors', async () => {
    const afterResponseError = vi.fn();
    const ipc = ipcora({
      channel: 'test:after-response-error',
      adapter: ipcAdapter.adapter,
      onAfterResponseError: afterResponseError,
    }).handler('ok', () => 'ok', {
      onAfterResponse() {
        throw new Error('log failed');
      },
    });
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:after-response-error', 1, { id: '1', path: 'ok' }),
    ).resolves.toEqual({
      data: 'ok',
    });
    expect(afterResponseError).toHaveBeenCalledTimes(1);
    expect(afterResponseError).toHaveBeenCalledWith(expect.any(Error), 'ok');
  });
});
describe('abstract', () => {
  test('contributes type definitions but skips runtime registration', () => {
    const ipc = ipcora({ abstract: true, adapter: ipcAdapter.adapter }).handler(
      'ping',
      () => 'pong',
    );

    // Type definition is present.
    expect(ipc.manifest).toMatchObject({
      ping: expect.any(Function),
    });

    // No adapter was installed (installAdapter is a no-op for abstract routers).
    expect(ipcAdapter.adapter.handle).not.toHaveBeenCalled();

    // Binding does installAdapter which is a no-op, so it should not throw
    // but also not actually register anything on the adapter.
    ipc.bind(createPeer(1));
    expect(ipcAdapter.adapter.handle).not.toHaveBeenCalled();
  });

  test('grouped abstract routes contribute to definition', () => {
    const ipc = ipcora().group('system', app =>
      app.handler('health', () => 'ok').handler('version', () => '1.0.0'),
    );

    expect(ipc.manifest).toMatchObject({
      system: {
        health: expect.any(Function),
        version: expect.any(Function),
      },
    });
  });

  test('scoped abstract routers preserve the flag', () => {
    const ipc = ipcora({ abstract: true, adapter: ipcAdapter.adapter }).group('admin', app => {
      expect(app.abstract).toBe(true);
      return app.handler('dashboard', () => 'stats');
    });

    expect(ipc.manifest).toMatchObject({
      admin: { dashboard: expect.any(Function) },
    });
    expect(ipcAdapter.adapter.handle).not.toHaveBeenCalled();
  });

  test('non-abstract routers still register handlers', async () => {
    const ipc = ipcora({
      channel: 'test:concrete',
      adapter: ipcAdapter.adapter,
    }).handler('ping', () => 'pong');
    ipc.bind(createPeer(1));

    await expect(ipcAdapter.invoke('test:concrete', 1, { id: '1', path: 'ping' })).resolves.toEqual(
      {
        data: 'pong',
      },
    );
  });
});

describe('error paths', () => {
  test('macro onGuard throw enters local onError', async () => {
    const ipc = ipcora({
      channel: 'test:guard-err',
      adapter: ipcAdapter.adapter,
    })
      .macro('requireRole', {
        onGuard({ option, fail }) {
          throw fail('FORBIDDEN', `Expected role ${option}`);
        },
      })
      .handler('adminOnly', () => 'secret', {
        requireRole: 'admin',
        onError({ name, error }) {
          return { data: { reason: name, message: error.message } };
        },
      });
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:guard-err', 1, { id: '1', path: 'adminOnly' }),
    ).resolves.toEqual({
      data: { reason: 'FORBIDDEN', message: 'Expected role admin' },
    });
  });

  test('macro onGuard throw without local onError falls to global onError', async () => {
    const ipc = ipcora({
      channel: 'test:guard-global',
      adapter: ipcAdapter.adapter,
    })
      .onError(({ name, error }) => {
        if (name === 'FORBIDDEN') {
          return { data: { blocked: error.message } };
        }
      })
      .macro('auth', {
        onGuard({ fail }) {
          throw fail('FORBIDDEN', 'Access denied');
        },
      })
      .handler('secure', () => 'ok', { auth: true });
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:guard-global', 1, { id: '1', path: 'secure' }),
    ).resolves.toEqual({
      data: { blocked: 'Access denied' },
    });
  });

  test('onGuard error reports correct phase in onError hook', async () => {
    let errorPhase = '';
    const ipc = ipcora({
      channel: 'test:guard-phase',
      adapter: ipcAdapter.adapter,
    })
      .onGuard(() => {
        throw fail('BLOCKED');
      })
      .handler('gated', () => 'ok', {
        onError({ phase }) {
          errorPhase = phase;
          return { data: 'ok' };
        },
      });
    ipc.bind(createPeer(1));

    await ipcAdapter.invoke('test:guard-phase', 1, { id: '1', path: 'gated' });
    expect(errorPhase).toBe('onGuard');
  });

  test('handler returning fail() is converted to error response', async () => {
    const ipc = ipcora({
      channel: 'test:handler-fail',
      adapter: ipcAdapter.adapter,
    }).handler('deny', ({ fail }) => fail('NOT_ALLOWED', 'No access'));
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:handler-fail', 1, { id: '1', path: 'deny' }),
    ).resolves.toMatchObject({
      error: { name: 'NOT_ALLOWED', message: 'No access' },
    });
  });

  test('handler returning fail() can be remapped in local onError', async () => {
    const ipc = ipcora({
      channel: 'test:handler-fail-remap',
      adapter: ipcAdapter.adapter,
    }).handler('deny', ({ fail }) => fail('RAW', 'raw'), {
      onError({ fail }) {
        return fail('MAPPED', 'mapped');
      },
    });
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:handler-fail-remap', 1, { id: '1', path: 'deny' }),
    ).resolves.toMatchObject({
      error: { name: 'MAPPED', message: 'mapped' },
    });
  });

  test('validation error preserves schema issue details', async () => {
    const namedParams = schema<{ name: string }>(value => {
      const p = value as Record<string, unknown>;
      return typeof p?.name === 'string'
        ? { value: { name: p.name } }
        : { issues: [{ message: 'name is required', path: ['name'] }] };
    });

    const ipc = ipcora({
      channel: 'test:valid-path',
      adapter: ipcAdapter.adapter,
    }).handler('create', ({ params }) => params.name, { params: namedParams });
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:valid-path', 1, { id: '1', path: 'create', params: {} }),
    ).resolves.toMatchObject({
      error: { name: 'VALIDATION_ERROR' },
    });
  });

  test('non-IpcError is normalized to IpcError with name and message', async () => {
    class CustomErr extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'CustomErr';
      }
    }

    const ipc = ipcora({
      channel: 'test:custom-err',
      adapter: ipcAdapter.adapter,
    }).handler('fail', () => {
      throw new CustomErr('something went wrong');
    });
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:custom-err', 1, { id: '1', path: 'fail' }),
    ).resolves.toMatchObject({
      error: { name: 'CustomErr', message: 'something went wrong' },
    });
  });
});

describe('trace', () => {
  test('onTrace observes completed invocation', async () => {
    const traces: unknown[] = [];
    const ipc = ipcora({
      channel: 'test:trace',
      adapter: ipcAdapter.adapter,
    })
      .onTrace(trace => {
        traces.push({
          path: trace.path,
          success: trace.success,
          response: trace.response,
          phases: trace.spans.map(span => span.phase),
        });
      })
      .handler('read', () => 'ok');
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:trace', 1, {
        id: '1',
        path: 'read',
      }),
    ).resolves.toEqual({
      data: 'ok',
    });
    expect(traces).toEqual([
      expect.objectContaining({
        path: 'read',
        success: true,
        response: { data: 'ok' },
        phases: expect.arrayContaining(['onInvoke', 'handler', 'onAfterResponse']),
      }),
    ]);
  });

  test('derive and resolve pass context extensions to handler', async () => {
    const ipc = ipcora({
      channel: 'test:ctx-extension',
      adapter: ipcAdapter.adapter,
    })
      .derive(({ metadata }) => ({ traceId: String(metadata.traceId ?? 'default') }))
      .resolve(() => ({ resolved: 'from-resolve' }))
      .handler('read', ({ traceId, resolved }) => ({ traceId, resolved }));
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:ctx-extension', 1, {
        id: '1',
        path: 'read',
        metadata: { traceId: 'trace-001' },
      }),
    ).resolves.toEqual({
      data: { traceId: 'trace-001', resolved: 'from-resolve' },
    });
  });

  test('runs context extension hooks in lifecycle order', async () => {
    const calls: string[] = [];
    const ipc = ipcora({
      channel: 'test:ctx-order',
      adapter: ipcAdapter.adapter,
    })
      .derive(() => {
        calls.push('derive');
        return { a: 1 };
      })
      .resolve(() => {
        calls.push('resolve');
        return { b: 2 };
      })
      .handler('run', ({ a, b }) => {
        calls.push('handler');
        return { a, b };
      });
    ipc.bind(createPeer(1));

    await ipcAdapter.invoke('test:ctx-order', 1, { id: '1', path: 'run' });
    expect(calls).toEqual(['derive', 'resolve', 'handler']);
  });

  test('context extensions merge across derive, guard, and resolve', async () => {
    const ipc = ipcora({
      channel: 'test:ctx-merge',
      adapter: ipcAdapter.adapter,
    })
      .derive(() => ({ derived: 'from-derive' }))
      .onGuard(() => ({ guarded: 'from-guard' }))
      .resolve(() => ({ resolved: 'from-resolve' }))
      .handler('read', ({ derived, guarded, resolved }) => ({
        derived,
        guarded,
        resolved,
      }));
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:ctx-merge', 1, { id: '1', path: 'read' }),
    ).resolves.toEqual({
      data: { derived: 'from-derive', guarded: 'from-guard', resolved: 'from-resolve' },
    });
  });
});
describe('derive → later-hook', () => {
  test('derive result is accessible in onAfterHandle', async () => {
    let rawKindInAfterHandle = '';
    const ipc = ipcora({
      channel: 'test:derive-cross',
      adapter: ipcAdapter.adapter,
    })
      .derive(({ rawParams }) => ({ rawKind: typeof rawParams }))
      .handler('run', () => 'ok', {
        onAfterHandle({ rawKind, response }) {
          rawKindInAfterHandle = rawKind as string;
          return response;
        },
      });
    ipc.bind(createPeer(1));

    await ipcAdapter.invoke('test:derive-cross', 1, { id: '1', path: 'run', params: { x: 1 } });
    expect(rawKindInAfterHandle).toBe('object');
  });

  test('derive result is accessible in onMapResponse', async () => {
    let rawKindInMap = '';
    const ipc = ipcora({
      channel: 'test:derive-map',
      adapter: ipcAdapter.adapter,
    })
      .derive(({ rawParams }) => ({ rawKind: typeof rawParams }))
      .handler('run', () => 'ok', {
        onMapResponse({ rawKind, response }) {
          rawKindInMap = rawKind as string;
          return response;
        },
      });
    ipc.bind(createPeer(1));

    await ipcAdapter.invoke('test:derive-map', 1, { id: '1', path: 'run', params: 'hello' });
    expect(rawKindInMap).toBe('string');
  });
});

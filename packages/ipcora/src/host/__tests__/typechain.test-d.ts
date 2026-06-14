import { assertType, describe, expectTypeOf, test } from 'vitest';

import { ipcora } from '../..';
import type { BuiltInErrorPayload, Ipcora, IpcResult, RouteHandler, StandardSchemaV1 } from '../..';
import type { Client, InvokeClient } from '../../client';
import { defineEvents } from '../../event';

/**
 * Type-chain regression tests.
 *
 * These tests verify that every link in the ipcora type chain stays intact
 * across refactors.  They exercise the full path from raw types → router →
 * definition → client inference.
 *
 * At runtime the `expectTypeOf` / `assertType` assertions are no-ops —
 * the actual checks happen during `vitest typecheck` / `vp check`.
 */

/**
 * Create a minimal StandardSchemaV1-shaped object for type inference.
 */
function schema<TResponse>(
  _validate?: (value: unknown) => { value: TResponse } | { issues: readonly { message: string }[] },
): StandardSchemaV1<unknown, TResponse> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: _validate ?? (() => ({ value: {} as TResponse })),
    },
  } as StandardSchemaV1<unknown, TResponse>;
}

function schemaIO<TInput, TResponse>(): StandardSchemaV1<TInput, TResponse> {
  return schema<TResponse>() as StandardSchemaV1<TInput, TResponse>;
}

// ===================================================================
// 1.  Schema → Handler → RouteHandler chain
// ===================================================================
describe('Schema → Handler → RouteHandler chain', () => {
  test('void params → zero-param RouteHandler', () => {
    const ipc = ipcora().handler('ping', () => 'pong' as const);
    type Def = typeof ipc.manifest;
    expectTypeOf<Def['ping']>().toEqualTypeOf<
      () => Promise<IpcResult<'pong', BuiltInErrorPayload>>
    >();
  });

  test('schema params → single-param RouteHandler with inferred param type', () => {
    const nameSchema = schema<{ name: string }>();

    const ipc = ipcora().handler(
      'user.create',
      ({ params }) => ({ id: 'u1' as const, name: params.name }),
      { params: nameSchema },
    );

    assertType<
      (params: {
        name: string;
      }) => Promise<IpcResult<{ readonly id: 'u1'; name: string }, BuiltInErrorPayload>>
    >(ipc.manifest.user.create);
  });

  test('response schema uses input type for handler and definition', () => {
    const numericString = schemaIO<string, number>();

    const ipc = ipcora().handler('parseable', () => '42', {
      response: numericString,
    });

    expectTypeOf<typeof ipc.manifest.parseable>().toEqualTypeOf<
      () => Promise<IpcResult<string, BuiltInErrorPayload>>
    >();

    ipcora().handler(
      'bad',
      // @ts-expect-error response handlers return the schema input type, not output type
      () => 42,
      { response: numericString },
    );
  });

  test('RouteHandler type alias matches concrete inference', () => {
    expectTypeOf<RouteHandler<void, string>>().toEqualTypeOf<
      () => Promise<IpcResult<string, BuiltInErrorPayload>>
    >();
    expectTypeOf<RouteHandler<{ id: number }, { name: string }>>().toEqualTypeOf<
      (params: { id: number }) => Promise<IpcResult<{ name: string }, BuiltInErrorPayload>>
    >();
  });

  test('IpcResult success / error branches are separable', () => {
    type R = IpcResult<string>;
    type Ok = Extract<R, { error: null }>;
    type Err = Extract<R, { data: null }>;

    expectTypeOf<Ok>().toMatchObjectType<{ data: string; error: null }>();
    expectTypeOf<Err>().toHaveProperty('error');
  });
});

// ===================================================================
// 2.  Context extension chain (state / decorate / derive / resolve)
// ===================================================================
describe('Context extension chain', () => {
  test('state extends TStore', () => {
    const ipc = ipcora()
      .state('version', 1 as const)
      .state('flags', { debug: true } as const);

    type Store = typeof ipc extends Ipcora<any, infer S> ? S : never;
    expectTypeOf<Store>().toEqualTypeOf<{ version: 1; flags: { readonly debug: true } }>();
  });

  test('decorate extends TContext', () => {
    const ipc = ipcora()
      .decorate('logger', { prefix: 'app' as const })
      .decorate('db', { url: 'localhost' as const });

    // Context type check: both decorated properties should be present
    type Ctx = typeof ipc extends Ipcora<infer C> ? C : never;
    type HasLogger = 'logger' extends keyof Ctx ? true : false;
    type HasDb = 'db' extends keyof Ctx ? true : false;
    expectTypeOf<HasLogger>().toEqualTypeOf<true>();
    expectTypeOf<HasDb>().toEqualTypeOf<true>();
  });

  test('derive extends TContext with returned shape', () => {
    const ipc = ipcora().derive(() => ({ rawKind: 'string' as const }));
    type Ctx = typeof ipc extends Ipcora<infer C> ? C : never;
    expectTypeOf<Ctx>().toEqualTypeOf<{ rawKind: 'string' }>();
  });

  test('resolve extends TContext with returned shape', () => {
    const ipc = ipcora().resolve(() => ({ doubled: 42 as const }));
    type Ctx = typeof ipc extends Ipcora<infer C> ? C : never;
    expectTypeOf<Ctx>().toEqualTypeOf<{ doubled: 42 }>();
  });

  test('chain state → decorate → derive → resolve merges all levels', () => {
    const ipc = ipcora()
      .state('count', 0)
      .decorate('env', 'test' as const)
      .derive(() => ({ derived: true as const }))
      .resolve(() => ({ resolved: 'yes' as const }));

    type Ctx = typeof ipc extends Ipcora<infer C> ? C : never;
    type Store = typeof ipc extends Ipcora<any, infer S> ? S : never;

    expectTypeOf<Ctx>().toMatchObjectType<{ env: 'test'; derived: true; resolved: 'yes' }>();
    expectTypeOf<Store>().toEqualTypeOf<{ count: number }>();
  });
});

// ===================================================================
// 3.  Group → nested definition paths
// ===================================================================
describe('Group prefix chain', () => {
  test('flat + group → nested definition tree', () => {
    const ipc = ipcora()
      .handler('ping', () => 'pong' as const)
      .group('api', app => app.handler('version', () => ({ v: '1.0.0' as const })));

    type Def = typeof ipc.manifest;
    expectTypeOf<Def['ping']>().toEqualTypeOf<
      () => Promise<IpcResult<'pong', BuiltInErrorPayload>>
    >();
    assertType<() => Promise<IpcResult<{ readonly v: '1.0.0' }, BuiltInErrorPayload>>>(
      ipc.manifest.api.version,
    );
  });

  test('nested groups produce deep definition trees', () => {
    const ipc = ipcora().group('a', a => a.group('b', b => b.handler('c', () => 42 as const)));

    type Def = typeof ipc.manifest;
    expectTypeOf<Def['a']['b']['c']>().toEqualTypeOf<
      () => Promise<IpcResult<42, BuiltInErrorPayload>>
    >();
  });

  test('handler with dotted path inside group creates nested nodes', () => {
    const ipc = ipcora().group('admin', admin => admin.handler('users.list', () => [] as const));

    type Def = typeof ipc.manifest;
    expectTypeOf<Def['admin']['users']['list']>().toEqualTypeOf<
      () => Promise<IpcResult<readonly [], BuiltInErrorPayload>>
    >();
  });
});

// ===================================================================
// 4.  Event type chain
// ===================================================================
describe('Event type chain', () => {
  test('events() produces typed event definitions on .manifest', () => {
    const ipc = ipcora().events(defineEvents({ update: schema<{ title: string }>() }));

    // definition has event property
    expectTypeOf<typeof ipc.manifest>().toHaveProperty('onUpdate');
    expectTypeOf<typeof ipc.manifest>().toHaveProperty('onOnceUpdate');

    // $emit has typed method
    type Emit = typeof ipc.$emit;
    expectTypeOf<Emit>().toHaveProperty('update');
  });

  test('tree events namespace → nested definition', () => {
    const ipc = ipcora().events(
      defineEvents({
        user: {
          login: schema<{ token: string }>(),
        },
      }),
    );

    type Def = typeof ipc.manifest;
    // Event is nested under "user"
    expectTypeOf<Def>().toHaveProperty('user');
    expectTypeOf<Def['user']>().toHaveProperty('onLogin');
    expectTypeOf<Def['user']>().toHaveProperty('onOnceLogin');

    assertType<(payload: { token: string }, options?: object) => Promise<void>>(
      ipc.$emit.user.login,
    );
    // @ts-expect-error dotted event names are emitted through nested properties
    expectTypeOf<(typeof ipc.$emit)['user.login']>();
  });

  test('defineEvents exposes inferred events on ~definition', () => {
    const baseEvents = defineEvents({
      system: {
        ready: schema<{ at: number }>(),
      },
    });
    const events = defineEvents({
      extends: [baseEvents],
      schema: {
        user: {
          created: schema<{ id: string }>(),
        },
      },
    });

    type Def = (typeof events)['~definition'];

    expectTypeOf<Def['handlers']>().toEqualTypeOf<{}>();
    expectTypeOf<Def['events']['system']['onReady']>().toExtend<{
      readonly payload: { at: number };
    }>();
    expectTypeOf<Def['events']['user']['onCreated']>().toExtend<{
      readonly payload: { id: string };
    }>();
  });

  test('$emit method accepts typed payload', () => {
    const ipc = ipcora().events(
      defineEvents({
        rename: schema<{ from: string; to: string }>(),
      }),
    );

    // $emit.rename should accept { from: string; to: string }
    type RenameFn = typeof ipc.$emit.rename;
    assertType<(payload: { from: string; to: string }, options?: object) => Promise<void>>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      0 as never as RenameFn,
    );
  });
});

// ===================================================================
// 5.  Macro type chain
// ===================================================================
describe('Macro type chain', () => {
  test('macro with derive injects context visible to handler', () => {
    const ipc = ipcora()
      .macro('withRole', {
        derive({ option }: { option: 'admin' | 'user' }) {
          return { role: option } as const;
        },
      })
      .handler(
        'adminOnly',
        ({ role }) => {
          const isAdmin: boolean = role === 'admin';
          return { isAdmin };
        },
        { withRole: 'admin' as const },
      );

    type Def = typeof ipc.manifest;
    expectTypeOf<Def['adminOnly']>().toEqualTypeOf<
      () => Promise<IpcResult<{ isAdmin: boolean }, BuiltInErrorPayload>>
    >();
  });

  test('macro factory (function form) resolves option type', () => {
    const ipc = ipcora()
      .macro('role', (role: 'admin' | 'member') => ({
        resolve() {
          return { role } as const;
        },
      }))
      .handler(
        'read',
        ({ role }) => {
          const canRead: boolean = role === 'admin';
          return { canRead };
        },
        { role: 'admin' as const },
      );

    type Def = typeof ipc.manifest;
    expectTypeOf<Def['read']>().toEqualTypeOf<
      () => Promise<IpcResult<{ canRead: boolean }, BuiltInErrorPayload>>
    >();
  });
});

// ===================================================================
// 6.  Error type chain
// ===================================================================
describe('Error type chain', () => {
  test('BuiltInErrorPayload covers standard IPC error names', () => {
    expectTypeOf<BuiltInErrorPayload['name']>().toEqualTypeOf<
      'PEER_NOT_BOUND' | 'HANDLER_NOT_FOUND' | 'VALIDATION_ERROR' | 'INTERNAL_SERVER_ERROR'
    >();
  });

  test('error(Class, mapper) → typed error name in route result', () => {
    class MyError extends Error {
      declare readonly code: 42;
    }

    const ipc = ipcora()
      .error(MyError, ({ fail, error }) =>
        fail('MY_ERR' as const, { message: error.message, data: undefined }),
      )
      .handler('failable', () => {
        throw new MyError('boom');
      });

    type Def = typeof ipc.manifest;
    type Result = Awaited<ReturnType<Def['failable']>>;

    // MY_ERR should be in the error union
    type MyPayload = Extract<Extract<Result, { error: unknown }>['error'], { name: 'MY_ERR' }>;
    expectTypeOf<MyPayload['name']>().toEqualTypeOf<'MY_ERR'>();
  });

  test('local onError contributes to route error union', () => {
    const ipc = ipcora().handler('safe', () => 'ok' as const, {
      onError({ fail }) {
        return fail('LOCAL_ERR' as const, 'local error');
      },
    });

    type Def = typeof ipc.manifest;
    type Result = Awaited<ReturnType<Def['safe']>>;
    type ErrorUnion = Extract<Result, { error: unknown }>['error'];

    // LOCAL_ERR should be present
    expectTypeOf<
      Extract<ErrorUnion, { name: 'LOCAL_ERR' }> extends never ? false : true
    >().toEqualTypeOf<true>();
  });
});

// ===================================================================
// 7.  Plugin merge chain
// ===================================================================
describe('Plugin merge chain', () => {
  test('use(plugin) merges routes into definition tree', () => {
    const plugin = ipcora().handler('plugin.route', () => 'from-plugin' as const);
    const app = ipcora()
      .handler('app.route', () => 'from-app' as const)
      .use(plugin);

    type Def = typeof app.manifest;
    // Dots in path become nested nodes
    expectTypeOf<Def['app']['route']>().toEqualTypeOf<
      () => Promise<IpcResult<'from-app', BuiltInErrorPayload>>
    >();
    expectTypeOf<Def['plugin']['route']>().toEqualTypeOf<
      () => Promise<IpcResult<'from-plugin', BuiltInErrorPayload>>
    >();
  });

  test('use(plugin) merges state', () => {
    const plugin = ipcora().state('pluginVersion', 2 as const);
    const app = ipcora()
      .state('appName', 'my-app' as const)
      .use(plugin);

    type Store = typeof app extends Ipcora<any, infer S> ? S : never;
    expectTypeOf<Store>().toEqualTypeOf<{ appName: 'my-app'; pluginVersion: 2 }>();
  });

  test('use(plugin) merges decorators (later plugin wins on conflict)', () => {
    const plugin = ipcora()
      .decorate('env', 'plugin-env' as const)
      .decorate('source', 'plugin' as const);

    const app = ipcora()
      .decorate('env', 'app-env' as const)
      .use(plugin);

    type Ctx = typeof app extends Ipcora<infer C> ? C : never;
    expectTypeOf<Ctx>().toEqualTypeOf<{ env: 'plugin-env'; source: 'plugin' }>();
  });

  test('use(plugin) merges macros', () => {
    const plugin = ipcora().macro('timed', {
      onBeforeHandle({ path: _ }: { path: string }) {},
      onAfterHandle({ response }: { response: unknown }) {
        return response;
      },
    });

    const app = ipcora().use(plugin);

    type Macros = typeof app extends Ipcora<any, any, infer M> ? M : never;
    expectTypeOf<Macros>().toHaveProperty('timed');
  });

  test('use(plugin) route conflict uses later plugin type', () => {
    const plugin = ipcora().handler('shared', () => 'from-plugin' as const);
    const app = ipcora()
      .handler('shared', () => 'from-app' as const)
      .use(plugin);

    type Def = typeof app.manifest;
    expectTypeOf<Def['shared']>().toEqualTypeOf<
      () => Promise<IpcResult<'from-plugin', BuiltInErrorPayload>>
    >();
  });

  test('handler registered after plugin overrides plugin route type', () => {
    const plugin = ipcora().handler('shared', () => 'from-plugin' as const);
    const app = ipcora()
      .use(plugin)
      .handler('shared', () => 'from-app' as const);

    type Def = typeof app.manifest;
    expectTypeOf<Def['shared']>().toEqualTypeOf<
      () => Promise<IpcResult<'from-app', BuiltInErrorPayload>>
    >();
  });

  test('use(plugin) merges state and macros with later plugin conflicts winning', () => {
    const plugin = ipcora()
      .state('source', 'plugin' as const)
      .macro('tag', {
        derive: () => ({ tag: 'plugin' as const }),
      });

    const app = ipcora()
      .state('source', 'app' as const)
      .macro('tag', {
        derive: () => ({ tag: 'app' as const }),
      })
      .use(plugin);

    type Store = typeof app extends Ipcora<any, infer S> ? S : never;
    type Macros = typeof app extends Ipcora<any, any, infer M> ? M : never;

    expectTypeOf<Store>().toEqualTypeOf<{ source: 'plugin' }>();
    expectTypeOf<Macros>().toHaveProperty('tag');
  });

  test('as(scoped) preserves public type chain', () => {
    const plugin = ipcora()
      .decorate('token', 'plugin-token' as const)
      .handler('auth.me', () => ({ id: 'u1' as const }))
      .as('scoped');

    const app = ipcora().use(plugin);

    type Ctx = typeof app extends Ipcora<infer C> ? C : never;
    type Def = typeof app.manifest;

    expectTypeOf<Ctx>().toEqualTypeOf<{ token: 'plugin-token' }>();
    expectTypeOf<Def['auth']['me']>().toEqualTypeOf<
      () => Promise<IpcResult<{ id: 'u1' }, BuiltInErrorPayload>>
    >();
  });
});

// ===================================================================
// 8.  Client type chain
// ===================================================================
describe('Client type chain', () => {
  test('InvokeClient maps flat definition to typed callers', () => {
    type Def = {
      ping: () => Promise<IpcResult<'pong', BuiltInErrorPayload>>;
    };
    type IC = InvokeClient<Def>;

    assertType<
      () => Promise<{ data: 'pong'; error: null } | { data: null; error: BuiltInErrorPayload }>
    >(0 as never as IC['ping']);
  });

  test('InvokeClient maps nested definition properties', () => {
    type Def = {
      user: {
        profile: {
          get: (id: string) => Promise<IpcResult<{ name: string }, BuiltInErrorPayload>>;
        };
      };
    };
    type IC = InvokeClient<Def>;
    expectTypeOf<IC>().toHaveProperty('user');
    expectTypeOf<IC['user']>().toHaveProperty('profile');
    expectTypeOf<IC['user']['profile']>().toHaveProperty('get');
  });

  test('Client<T> produces invoke and event branches from ~definition shape', () => {
    type Def = {
      handlers: {
        ping: () => Promise<IpcResult<'pong', BuiltInErrorPayload>>;
      };
      events: {};
    };
    type C = Client<Def>;
    expectTypeOf<C>().toHaveProperty('invoke');
    expectTypeOf<C>().toHaveProperty('event');
    expectTypeOf<C['invoke']>().toHaveProperty('ping');
  });
});

// ===================================================================
// 9.  Full combined roundtrip
// ===================================================================
describe('Full combined roundtrip', () => {
  test('handlers + groups + events + macros + plugin all coexist', () => {
    const nameSchema = schema<{ name: string }>();
    const titleSchema = schema<{ title: string }>();

    const authPlugin = ipcora()
      .state('authToken', 'secret' as const)
      .handler('auth.status', () => ({ authenticated: true as const }));

    const ipc = ipcora()
      .state('appVersion', '1.0.0' as const)
      .decorate('env', 'production' as const)
      .use(authPlugin)
      .handler('ping', () => 'pong' as const)
      .handler('user.create', ({ params }) => ({ id: 'u1' as const, name: params.name }), {
        params: nameSchema,
      })
      .group('admin', admin => admin.handler('dashboard', () => ({ visits: 42 as const })))
      .events(defineEvents({ update: titleSchema }));

    type Def = typeof ipc.manifest;

    // Handlers from root
    expectTypeOf<Def['ping']>().toEqualTypeOf<
      () => Promise<IpcResult<'pong', BuiltInErrorPayload>>
    >();

    // Handlers with schema params
    assertType<
      (params: {
        name: string;
      }) => Promise<IpcResult<{ readonly id: 'u1'; name: string }, BuiltInErrorPayload>>
    >(ipc.manifest.user.create);

    // Handlers from plugin
    assertType<() => Promise<IpcResult<{ readonly authenticated: true }, BuiltInErrorPayload>>>(
      ipc.manifest.auth.status,
    );

    // Handlers from group
    assertType<() => Promise<IpcResult<{ readonly visits: 42 }, BuiltInErrorPayload>>>(
      ipc.manifest.admin.dashboard,
    );

    // Event definitions present
    expectTypeOf<Def>().toHaveProperty('onUpdate');

    // Store merged
    type Store = typeof ipc extends Ipcora<any, infer S> ? S : never;
    expectTypeOf<Store>().toEqualTypeOf<{ appVersion: '1.0.0'; authToken: 'secret' }>();

    // Context
    type Ctx = typeof ipc extends Ipcora<infer C> ? C : never;
    expectTypeOf<Ctx>().toMatchObjectType<{ env: 'production' }>();

    // $emit
    expectTypeOf<typeof ipc.$emit>().toHaveProperty('update');

    // ~definition protocol
    type Proto = (typeof ipc)['~definition'];
    expectTypeOf<Proto['handlers']>().toHaveProperty('ping');
    expectTypeOf<Proto['handlers']>().toHaveProperty('user');
    expectTypeOf<Proto['handlers']>().toHaveProperty('auth');
    expectTypeOf<Proto['handlers']>().toHaveProperty('admin');
    expectTypeOf<Proto['events']>().toHaveProperty('onUpdate');
  });

  test('definition → Client<Def> invoke roundtrip', () => {
    const addSchema = schema<{ a: number; b: number }>();

    const ipc = ipcora()
      .handler('ping', () => 'pong' as const)
      .handler('math.add', ({ params }) => params.a + params.b, { params: addSchema });

    type Def = (typeof ipc)['~definition'];
    type C = Client<Def>;

    // invoke.ping() → Result<'pong'>
    type PingR = Awaited<ReturnType<C['invoke']['ping']>>;
    expectTypeOf<PingR>().toEqualTypeOf<
      { data: 'pong'; error: null } | { data: null; error: BuiltInErrorPayload }
    >();

    // invoke.math.add({a, b}) → Result<number>
    type AddR = Awaited<ReturnType<C['invoke']['math']['add']>>;
    // Verify data branch exists
    type AddOk = Extract<AddR, { error: null }>;
    expectTypeOf<AddOk>().toMatchObjectType<{ data: number; error: null }>();
    // Verify error branch exists
    type AddErr = Extract<AddR, { data: null }>;
    expectTypeOf<AddErr>().toMatchObjectType<{ data: null; error: BuiltInErrorPayload }>();
  });
});

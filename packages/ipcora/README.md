# ipcora

Transport-agnostic typed IPC router for TypeScript.

## Install

```bash
pnpm add ipcora
```

## Concepts

An `Ipcora` instance is a **router** that owns:

- **Routes** — named handlers (`"user.get"`, `"admin.stats"`) with typed params, response, and errors
- **Lifecycle hooks** — phases from `onInvoke` through `onTrace`
- **Plugins** — `use()` composes entire routers
- **Macros** — reusable hook bundles (e.g. `requireAdmin`)
- **Bindings** — registered peers (callers) that can invoke routes
- **Event definitions** — typed push events emitted to bound peers

The router is **transport-agnostic**: you provide an `IpcAdapter` to wire it into a real IPC channel (Electron `ipcMain`, WebSocket, Node.js `MessagePort`, etc.).

## Quick Start — Memory Adapter

```ts
import { ipcora, fail, type IpcAdapter } from 'ipcora';

// A minimal in-memory adapter for testing / local-only use
const handlers = new Map<string, Function>();
const adapter: IpcAdapter = {
  handle: (ch, fn) => handlers.set(ch, fn),
  emit: (ch, sender, payload) => sender.send?.(ch, payload),
  listenerCount: ch => (handlers.has(ch) ? 1 : 0),
  removeHandler: ch => handlers.delete(ch),
};

const ipc = ipcora({ channel: 'app', adapter }).handler('ping', () => 'pong');

// Bind a peer
ipc.bind({ sender: { id: 1 } });

// Invoke
const handler = handlers.get('app')!;
const response = await handler({ sender: { id: 1 } }, { id: 'r1', path: 'ping' });
// { data: "pong" }
```

## Creating a Router

```ts
ipcora<TContext, TStore>(options?: IpcoraOptions)
```

### Options

| Option        | Type         | Default           | Description                                          |
| ------------- | ------------ | ----------------- | ---------------------------------------------------- |
| `channel`     | `string`     | `"ipcora:invoke"` | IPC channel name used by the adapter                 |
| `name`        | `string`     | —                 | Unique name; prevents duplicate adapter installation |
| `adapter`     | `IpcAdapter` | —                 | Transport bridge (required for runtime)              |
| `abstract`    | `boolean`    | `false`           | Type-only router (no runtime registration)           |
| `exposeStack` | `boolean`    | dev mode          | Include error stacks in responses                    |

## Routes & Handlers

### `.handler(path, fn, options?)`

Register a named handler. The path supports dot notation for nesting.

```ts
const ipc = ipcora<{ tenant: string }>({ channel: 'app', adapter })
  .handler(
    'user.get',
    ({ params, tenant }) => {
      // params is typed from the schema
      return { id: params.id, tenant };
    },
    {
      params: userParamsSchema, // Standard Schema V1
      response: userOutputSchema, // validates return value
      validateResponse: true, // set false to skip this route's response validation
    },
  )
  .handler('ping', () => 'pong');
```

Response validation is enabled by default. Disable it globally with
`ipcora({ validateResponse: false })`, or per route with
`{ validateResponse: false }`.

### Handler Context

The handler receives a merged context object:

| Field       | Type                      | Description                                                      |
| ----------- | ------------------------- | ---------------------------------------------------------------- |
| `params`    | schema output             | Validated params (if schema provided)                            |
| `rawParams` | `unknown`                 | Raw params before validation                                     |
| `peer`      | `IpcPeer`                 | The bound peer that sent the request                             |
| `metadata`  | `Record<string, unknown>` | Call metadata                                                    |
| `signal`    | `AbortSignal`             | Abort controller signal                                          |
| `fail`      | `typeof fail`             | Factory for typed errors                                         |
| `store`     | `TStore`                  | Shared mutable state                                             |
| `id`        | `string`                  | Request ID                                                       |
| `path`      | `string`                  | Route path                                                       |
| ...context  | `TContext`                | All context extensions (state, decorate, derive, resolve, guard) |

### Returning Errors

```ts
import { fail } from 'ipcora';

ipc.handler('protected', ({ fail, isAdmin }) => {
  if (!isAdmin) throw fail('FORBIDDEN', { message: 'Admin only' });
  return 'ok';
});
```

`fail()` returns an `IpcError` — a typed `Error` subclass with `name`, `message`, optional `data`, and optional `cause`.

## Groups

```ts
ipc.group('admin', admin =>
  admin.handler('stats', () => ({ users: 42 })).handler('config', () => ({ debug: false })),
);
// Registers: "admin.stats", "admin.config"
```

Groups inherit parent hooks and macros. You can add group-specific hooks.

## Lifecycle Hooks

Every request flows through a fixed lifecycle. `onError` runs when an earlier phase fails, `onAfterResponse` always runs after response creation, and `onTrace` observes the completed invocation.

```
onInvoke
  → onTransform
  → derive
  → onGuard
  → validation          (Standard Schema — not user-registerable)
  → resolve
  → onBeforeHandle
  → handler
  → onAfterHandle
  → onMapResponse
  → (success) onAfterResponse
  → (error)   onError → onAfterResponse
  → onTrace
```

### Hooks

Hooks can be registered **globally** (`.onInvoke(...)`) or **locally** (per `handler()` options).

#### `.onInvoke(hook)`

First hook. Inspect the raw request before any processing.

```ts
ipc.onInvoke(({ id, path, request }) => {
  console.log(`[${id}] ${path}`);
});
```

#### `.onTransform(hook)`

Normalize raw params before validation. Return transformed params or void to keep original.

```ts
ipc.onTransform(({ params }) => {
  if (params && typeof params === 'object') {
    const trimmed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) {
      trimmed[k] = typeof v === 'string' ? v.trim() : v;
    }
    return trimmed;
  }
});
```

#### `.derive(hook)`

Derive context from raw request data. Runs **before** validation. Return value merges into handler context.

```ts
ipc.derive(({ rawParams, metadata }) => ({
  rawType: typeof rawParams,
  hasMetadata: metadata != null && Object.keys(metadata).length > 0,
}));
```

#### `validation` _(internal phase)_

Standard Schema validation of params against the route's schema. Not a registerable hook, but reported in `onError` phase info.

#### `.resolve(hook)`

Derive context from parsed (validated) params. Runs **after** validation.

```ts
ipc.resolve(({ peer, metadata }) => ({
  requestId: `req-${peer.id}-${Date.now()}`,
}));
```

#### `.onGuard(hook)`

Permission / role resolution. Runs **before** validation — guards can short-circuit early without paying schema validation cost. Receives raw (unvalidated) params. Return value merges into context.

```ts
ipc.onGuard(({ params, metadata, fail }) => {
  const user = metadata.user as { role: string } | undefined;
  if (!user) throw fail('UNAUTHORIZED');
  return { isAdmin: user.role === 'admin' };
});
```

#### `.onBeforeHandle(hook)`

Final guard before the handler executes. Can inspect signal for abort.

```ts
ipc.onBeforeHandle(({ signal, fail }) => {
  if (signal.aborted) throw fail('ABORTED', { message: 'Request aborted' });
});
```

#### `.onAfterHandle(hook)`

Transform or inspect the handler's return value. Return a new value to replace the response.

```ts
ipc.onAfterHandle(({ response }) => {
  if (response && typeof response === 'object') {
    return { ...response, _timestamp: Date.now() };
  }
});
```

#### `.onMapResponse(hook)`

Final chance to rewrite the full response shape (`{ data }` or `{ error }`).

```ts
ipc.onMapResponse(({ response }) => {
  // Add a wrapper envelope
  return { ...response, _version: 2 };
});
```

#### `.onError(hook)` _(error path)_

Catch and potentially rewrite errors. Can return a new response, a new `fail()`, or `undefined` to pass through the default error.

```ts
ipc.onError(({ name, phase, error, fail }) => {
  console.error(`Error "${name}" in phase "${phase}"`);
  if (name === 'DB_UNAVAILABLE') {
    return { error: { name, message: 'Please try again later' } };
  }
});
```

The hook receives:
| Field | Type | Description |
|---|---|---|
| `name` | `string` | Error name |
| `message` | `string` | Error message |
| `error` | `IpcError` | Full IpcError object |
| `phase` | `LifecyclePhase` | The phase in which the error occurred |
| `cause` | `unknown` | Original error cause |
| `fail` | `typeof fail` | Factory to create a new error |

#### `.onAfterResponse(hook)`

Always runs last, whether success or error. Fire-and-forget — return value is ignored.

```ts
ipc.onAfterResponse(({ success, duration, path, phase }) => {
  if (!success) {
    console.warn(`FAIL ${path} in ${phase} (${duration.toFixed(1)}ms)`);
  }
});
```

Receives: `success`, `duration`, `response`, `response`, `params`, `cause`, `phase`.

## Plugins

`use()` accepts another Ipcora instance and composes it as a plugin.

For context extension, use `decorate`, `derive`, `onGuard`, or `resolve`. For completed-call observation and timing, use `onTrace`.

```ts
ipc
  .derive(({ path }) => ({ logger: createLogger(path) }))
  .onTrace(({ path, duration }) => {
    console.log(`${path} took ${duration}ms`);
  });
```

You can compose routers by `use()`-ing one Ipcora instance into another. The plugin's routes, hooks, macros, error mappers, state, and decorators are merged into the parent.

```ts
// Define a reusable auth plugin
const authPlugin = ipcora({ name: 'auth' })
  .macro('requireAuth', {
    onGuard({ fail }) {
      throw fail('UNAUTHORIZED');
    },
  })
  .handler('auth.login', () => 'token');

// Use it in the main app
const app = ipcora({ channel: 'app', adapter })
  .use(authPlugin)
  .handler('ping', () => 'pong');
```

**Deduplication behavior:** Named plugins (with a `name`, plus optional `seed`) are deduplicated per parent router. Reusing the same named plugin in the same parent is a no-op, while different parent routers can reuse it independently. Unnamed plugins are not deduplicated.

**Merge strategy:**

- Routes: merged; duplicate paths are replaced by the later registration
- Hooks: parent hooks registered before `use(plugin)` run first, plugin route hooks run second
- Macros / error mappers / events: merged; later registration wins on conflict
- State / decorators: merged; later registration wins on conflict

Plugin hooks are local by default: they apply to the plugin's own routes, but not to parent routes registered after `use(plugin)`. Use `.as('scoped')` to export plugin hooks to later parent routes:

```ts
const authPlugin = ipcora()
  .derive(() => ({ user: { id: 'u1' } }))
  .as('scoped');

const app = ipcora()
  .use(authPlugin)
  .handler('me', ({ user }) => user);
```

## Macros

Reusable hook bundles with typed options. Macros compose lifecycle hooks, schemas, guard logic, and transformations into a single keyword that can be referenced in any `handler()` options.

### Object form — static hooks

```ts
ipc.macro("requireAdmin", {
  onGuard({ isAdmin, fail }) {
    if (!isAdmin) throw fail("FORBIDDEN", { message: "Admin role required" });
  },
  onAfterHandle({ response }) {
    console.log("Admin action:", response);
  },
});

// Usage — option value is `true` (just enables the macro)
ipc.handler("admin.dashboard", () => ({ ... }), {
  requireAdmin: true,
});
```

### Factory form — dynamic hooks

```ts
ipc.macro('rateLimit', (maxCalls: number) => ({
  onBeforeHandle({ store, path, fail }) {
    const key = `rate:${path}`;
    const count = (store[key] ?? 0) + 1;
    store[key] = count;
    if (count > maxCalls) throw fail('RATE_LIMITED', { message: `Max ${maxCalls} calls` });
  },
}));

// Usage — option value is the factory parameter
ipc.handler('api.search', ({ params }) => search(params), {
  rateLimit: 100, // maxCalls = 100
});

ipc.handler('api.upload', upload, {
  rateLimit: 10, // maxCalls = 10
});
```

### The `option` field

When a macro hook runs, the option value is available as `option` in the hook context:

```ts
ipc.macro('loggable', {
  onBeforeHandle({ path, option }) {
    console.log(`[macro:loggable] ${path}:${option}`);
  },
});

ipc.handler('checkout', pay, { loggable: 'checkout-audit' });
// option === "checkout-audit"
```

### Nested macros

A macro can reference another macro. The expansion auto-deduplicates to prevent infinite loops:

```ts
ipc
  .macro('audited', {
    onAfterHandle({ response }) {
      console.log('Audit:', response);
    },
  })
  .macro('secure', {
    requireAdmin: true, // ← references the requireAdmin macro
    audited: true, // ← references the audited macro
  });

ipc.handler('deleteUser', deleteFn, { secure: true });
// Runs: onGuard (requireAdmin) → handler → onAfterHandle (audited)
```

### `option === false` skips the macro

```ts
ipc.handler('public.info', infoFn, { requireAdmin: false });
// Macro is skipped entirely
```

### Macro lifecycle hooks

A macro definition can include any of these hook keys:

```ts
ipc.macro('fullAudit', {
  onInvoke({ id, option }) {
    /* ... */
  },
  onTransform({ params }) {
    /* return transformed params */
  },
  derive({ rawParams, option }) {
    /* return context extension */
  },
  resolve({ params, option }) {
    /* return context extension */
  },
  onGuard({ option, fail }) {
    /* permission check */
  },
  onBeforeHandle({ option }) {
    /* pre-handler guard */
  },
  onAfterHandle({ response }) {
    /* transform response */
  },
  onMapResponse({ response }) {
    /* rewrite response */
  },
  onError({ name, error }) {
    /* rewrite error */
  },
  onAfterResponse({ success }) {
    /* logging */
  },
  params: mySchema, // appended to route params schemas
  response: myOutputSchema, // appended to route response schemas
});
```

All hooks receive the `option` value from the handler options. `derive`, `resolve`, and `onGuard` can return context extensions.

## State & Decorators

```ts
const ipc = ipcora({ channel: 'app', adapter })
  .state('counter', 0) // mutable, shared across all peers
  .state({ config: { debug: true } }) // batch form
  .decorate('version', '2.0') // static, per-request copy
  .decorate({ region: 'us-east-1' });

ipc.handler('inc', ({ store, version }) => {
  store.counter += 1;
  return { count: store.counter, version };
});
```

## Events

```ts
import { defineEvents } from 'ipcora/event';
import { z } from 'zod'; // or arktype, valibot, etc.

const ipc = ipcora({ channel: 'app', adapter }).events(
  defineEvents({
    userLogin: z.object({ userId: z.string(), at: z.number() }),
  }),
);

// Emit to all bound peers
ipc.$emit.userLogin({ userId: 'u1', at: Date.now() });

// Emit to specific peers
ipc.$emit.userLogin({ userId: 'u1', at: Date.now() }, { peers: [peer1, peer2] });
```

## Creating a Typed Client

Install and import from `ipcora/client`:

```ts
import { ipcoraClient, type InferDefinition } from 'ipcora/client';

type Def = InferDefinition<typeof ipc>;
const client = ipcoraClient<Def>({
  adapter: {
    invoke(call) {
      // call.channel — dotted path like "user.get"
      // call.args    — params array
      // call.metadata — merged metadata
      return transport.invoke(call.channel, call.args[0], call.metadata);
    },
    subscribe(call) {
      // call.channel  — event channel like "app:event:userLogin"
      // call.listener — payload callback after event schema output parsing
      // call.once     — boolean
      return transport.subscribe(call.channel, call.listener);
    },
  },
  eventSchema: events, // validates delivered event payloads on the client
  metadata: { appVersion: '1.0' }, // static metadata
  hooks: {
    onInvoke: [call => ({ metadata: { traceId: '...' } })], // dynamic per-call metadata
  },
});

// Typed invoke
const user = await client.invoke.user.get({ id: '1' });

// Typed events
const unsub = client.event.onUserLogin(({ userId, at }) => {
  console.log(`${userId} logged in at ${at}`);
});
```

### Client Types

| Export                  | Description                                         |
| ----------------------- | --------------------------------------------------- |
| `ipcoraClient<T>(opts)` | Factory function                                    |
| `Client<T>`             | `{ invoke, event }` typed proxy                     |
| `InferDefinition<T>`    | Extract route & event types from an Ipcora instance |
| `IpcoraClientOptions`   | Options type for `ipcoraClient`                     |
| `ClientCall`            | Shape passed to `invoke` adapter                    |
| `ClientSubscription`    | Shape passed to `subscribe` adapter                 |

## Custom Adapter

Implement the `IpcAdapter` interface to connect to any transport:

```ts
interface IpcAdapter<TEvent extends IpcEvent = IpcEvent> {
  handle(
    channel: string,
    handler: (event: TEvent, invoke: IpcInvoke) => MaybePromise<IpcResponse>,
  ): void;
  emit(channel: string, sender: TEvent['sender'], payload: unknown): MaybePromise<void>;
  listenerCount(channel: string): number;
  removeHandler(channel: string): void;
}
```

## Error Mapping

Map custom `Error` subclasses to typed `IpcError` payloads:

```ts
class DatabaseError extends Error {}
class ValidationError extends Error {}

ipc
  .error(DatabaseError, ({ fail, error }) => fail('DB_UNAVAILABLE', { message: error.message }))
  .error(ValidationError, ({ fail, error }) =>
    fail('VALIDATION_CUSTOM', { message: error.message }),
  );
```

## Abstract Routers

Type-only routers for sharing definitions without runtime overhead:

```ts
const types = ipcora({ abstract: true }).handler(
  'user.get',
  (params: string) => ({}) as { id: string },
);

// types.definition carries full type info
// types.bind() is a no-op — no adapter calls
```

## Type Reference

### Main exports (`ipcora`)

| Export     | Kind     | Description                         |
| ---------- | -------- | ----------------------------------- |
| `ipcora`   | function | Create a router instance            |
| `fail`     | function | Create a typed `IpcError`           |
| `IpcError` | class    | Typed error class                   |
| `Ipcora`   | class    | Router class (for type annotations) |

### Client exports (`ipcora/client`)

| Export                | Kind     | Description                      |
| --------------------- | -------- | -------------------------------- |
| `ipcoraClient`        | function | Create a typed Proxy client      |
| `Client`              | type     | Client shape `{ invoke, event }` |
| `InferDefinition`     | type     | Extract type from router         |
| `IpcoraClientOptions` | type     | Options for `ipcoraClient`       |
| `ClientMetadata`      | type     | Metadata value type              |
| `Unsubscribe`         | type     | Cleanup function type            |

### Event exports (`ipcora/event`)

| Export         | Kind     | Description                             |
| -------------- | -------- | --------------------------------------- |
| `defineEvents` | function | Identity helper for typed event schemas |

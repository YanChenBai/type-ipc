# @ipcora/electron

Electron integration for `ipcora` — typed IPC across main, preload, and renderer processes.

## Install

```bash
pnpm add @ipcora/electron electron ipcora
```

> `electron` and `ipcora` are peer dependencies.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Main Process                                            │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ @ipcora/electron/main                               │ │
│ │ electronIpcora()                                    │ │
│ │   .handler("user.get", ({ params }) => ...)         │ │
│ │ bindWindow(ipc, win)                                │ │
│ └─────────────────────────────────────────────────────┘ │
└────────────────────┬────────────────────────────────────┘
                     │ ipcMain.handle / webContents.send
┌────────────────────┴────────────────────────────────────┐
│ Preload Script                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ @ipcora/electron/preload                            │ │
│ │ exposeIpcoraBridge()                                │ │
│ │ // → window.__IPCORA__ = { invoke, subscribe }      │ │
│ └─────────────────────────────────────────────────────┘ │
└────────────────────┬────────────────────────────────────┘
                     │ contextBridge
┌────────────────────┴────────────────────────────────────┐
│ Renderer Process                                        │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ @ipcora/electron/renderer                           │ │
│ │ electronIpcoraClient<Def>()                           │ │
│ │ client.invoke.user.get({ id: "1" })   // typed!     │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Modules

| Import                      | Use in                             |
| --------------------------- | ---------------------------------- |
| `@ipcora/electron`          | Main process (re-exports `./main`) |
| `@ipcora/electron/main`     | Main process                       |
| `@ipcora/electron/preload`  | Preload script                     |
| `@ipcora/electron/renderer` | Renderer process                   |

---

## Main Process

### `electronIpcora(options?)` → `ElectronIpcora`

Create a fully typed ipcora router backed by Electron's `ipcMain`. The Electron channel is fixed internally.

```ts
import { electronIpcora } from '@ipcora/electron';
// or: import { electronIpcora } from "@ipcora/electron/main";

const ipc = electronIpcora<{ tenant: string }>()
  .state('users', new Map())
  .handler('ping', () => 'pong')
  .handler('user.get', ({ params, store }) => {
    return store.users.get(params.id);
  });
```

### `bindWindow(ipc, window)` → `BoundBrowserWindow`

Bind a `BrowserWindow` as a callable peer. Returns a per-window handle with `emit`, `$emit`, and `unbind`.

```ts
import { BrowserWindow } from 'electron';
import { bindWindow } from '@ipcora/electron';

const win = new BrowserWindow({
  /* ... */
});

const binding = bindWindow(ipc, win);

// binding.emit(...) sends typed events to this window.
binding.unbind();

// The BrowserWindow.id becomes the peer ID.
// When the window closes, the peer auto-unbinds.
```

`context` is optional. Use it when handlers need per-window values such as tenant, authenticated user, role, or session state.

### `electronIpcAdapter()` → `ElectronIpcAdapter`

Low-level adapter factory. Use if you need the raw adapter without creating a full ipcora instance.

```ts
import { electronIpcAdapter } from '@ipcora/electron';

const adapter = electronIpcAdapter();
adapter.handle('my-channel', (event, request) => {
  // event.sender is WebContents
  return { data: 'ok' };
});
```

### `electronBrowserWindowPeer(window)` → `ElectronIpcPeer`

Wrap a `BrowserWindow` as an `IpcPeer` without binding. Useful for advanced peer management.

```ts
import { electronBrowserWindowPeer } from '@ipcora/electron';

const peer = electronBrowserWindowPeer(myWindow);
peer.id; // BrowserWindow.id
peer.sender; // webContents (used for emit/send)
peer.window; // BrowserWindow reference
```

### Main Process Types

```ts
import type {
  ElectronIpcEvent, // IpcMainInvokeEvent & IpcEvent<WebContents>
  ElectronIpcMain, // Pick<IpcMain, "handle" | "listenerCount" | "removeHandler">
  ElectronIpcAdapter, // IpcAdapter<ElectronIpcEvent>
  ElectronIpcora, // Ipcora with BrowserWindow-aware bind(...)
  ElectronIpcoraOptions, // IpcoraOptions without adapter/channel
  ElectronIpcPeer, // IpcPeer<WebContents> & { window: BrowserWindow }
  BoundBrowserWindow,
} from '@ipcora/electron';
```

---

## Preload Script

### `exposeIpcoraBridge(options?)`

Call once in your preload script. Uses `contextBridge.exposeInMainWorld` to safely expose `invoke` and `subscribe` to the renderer.

```ts
// preload.ts
import { exposeIpcoraBridge } from '@ipcora/electron/preload';

exposeIpcoraBridge();
```

After this call, `window.__IPCORA__` exposes:

```ts
window.__IPCORA__.invoke(request: IpcInvoke): Promise<IpcResponse>
window.__IPCORA__.subscribe(eventChannel: string, listener: (payload: unknown) => void): () => void
```

### Preload Types

```ts
import type { IpcoraBridge } from '@ipcora/electron/preload';
```

---

## Renderer Process

### `electronIpcoraClient(options?)` → `Client`

Create a fully typed Proxy client backed by the preload bridge.

```ts
// renderer.ts
import { electronIpcoraClient, type InferDefinition } from '@ipcora/electron/renderer';
import type { AppIpcora } from '../main/ipc'; // type-only import — zero runtime cost

const client = electronIpcoraClient<InferDefinition<AppIpcora>>({
  metadata: { appVersion: '1.0' }, // static metadata
  hooks: {
    onInvoke: [call => ({ metadata: { traceId: '...' } })], // dynamic per-call metadata
  },
});

// Typed invoke
const user = await client.invoke.user.get({ id: '1' });
//    ^ { data: { id: string; name: string; email: string } | null;
//        error: { name: string; message: string } | null }

const pong = await client.invoke.ping();
//    ^ { data: "pong"; error: null }

// Typed events
const unsub = client.event.onUserLogin(({ userId, at }) => {
  console.log(`${userId} logged in at ${new Date(at).toISOString()}`);
});
```

### Options

| Option             | Type                      | Default | Description                            |
| ------------------ | ------------------------- | ------- | -------------------------------------- |
| `metadata`         | `Record<string, unknown>` | —       | Static metadata merged into every call |
| `hooks.onInvoke`   | `ClientInvokeHook[]`      | —       | Dynamic per-call invoke hook           |
| `throwInvokeError` | `boolean`                 | `false` | Throw `IpcError` for invoke errors     |

### Renderer Types

```ts
import type {
  ElectronIpcoraClientOptions,
  InferDefinition,
  Client,
  IpcoraClientOptions,
} from '@ipcora/electron/renderer';
```

---

## Full Example

### `src/main/ipc.ts` (main process — shared types)

```ts
import { electronIpcora, fail } from '@ipcora/electron';

export const ipc = electronIpcora<{ tenant: string }, { users: Map<string, User> }>()
  .state('users', new Map<string, User>())
  .handler('user.create', ({ params, store }) => {
    const user = { id: crypto.randomUUID(), ...params };
    store.users.set(user.id, user);
    return user;
  })
  .handler('user.get', ({ params, store, fail }) => {
    const user = store.users.get(params.id);
    if (!user) throw fail('NOT_FOUND', { message: `User ${params.id} not found` });
    return user;
  });

export type AppIpcora = typeof ipc;
```

### `src/main/index.ts` (main process — bind windows)

```ts
import { BrowserWindow } from 'electron';
import { bindWindow } from '@ipcora/electron/main';
import { ipc } from './ipc';

function createWindow() {
  const win = new BrowserWindow({
    webPreferences: { preload: path.join(__dirname, '../preload/index.js') },
  });
  bindWindow(ipc, win);
  return win;
}
```

### `src/preload/index.ts` (preload script)

```ts
import { exposeIpcoraBridge } from '@ipcora/electron/preload';
exposeIpcoraBridge();
```

### `src/renderer/app.ts` (renderer)

```ts
import { electronIpcoraClient, type InferDefinition } from '@ipcora/electron/renderer';
import type { AppIpcora } from '../main/ipc';

const client = electronIpcoraClient<InferDefinition<AppIpcora>>();

// Create a user
const newUser = await client.invoke.user.create({ name: 'Alice', email: 'alice@acme.com' });
if (newUser.data) {
  console.log('Created:', newUser.data.id);
}

// Get a user
const result = await client.invoke.user.get({ id: newUser.data!.id });
if (result.error) {
  console.error(`${result.error.name}: ${result.error.message}`);
} else {
  console.log('Found:', result.data.name);
}
```

---

## Reference

### Electron-Specific Types

| Type                          | Shape                                                             |
| ----------------------------- | ----------------------------------------------------------------- |
| `ElectronIpcEvent`            | `IpcMainInvokeEvent & IpcEvent<WebContents>`                      |
| `ElectronIpcMain`             | `Pick<IpcMain, "handle" \| "listenerCount" \| "removeHandler">`   |
| `ElectronIpcAdapter`          | `IpcAdapter<ElectronIpcEvent>`                                    |
| `ElectronIpcora`              | `Ipcora` backed by Electron's fixed IPC channel                   |
| `ElectronIpcoraOptions`       | `IpcoraOptions` without `adapter` or `channel`                    |
| `ElectronIpcPeer`             | `IpcPeer<WebContents> & { window: BrowserWindow }`                |
| `BoundBrowserWindow`          | `{ id, window, emit, $emit, unbind }`                             |
| `IpcoraBridge`                | `{ invoke, subscribe }` — exposed to renderer via `contextBridge` |
| `ElectronIpcoraClientOptions` | `{ metadata?, hooks?, eventSchema?, throwInvokeError? }`          |

### How Events Work

```
Router: ipc.$emit.userLogin(payload)
  → adapter.emit("ipcora:electron:event:userLogin", webContents, payload)
  → webContents.send("ipcora:electron:event:userLogin", payload)

Preload bridge: ipcRenderer.on("ipcora:electron:event:userLogin", handler)
  → bridge.subscribe("app:ipc:event:userLogin", listener)

Client: client.event.onUserLogin(listener)
  → createEventSubscriber → bridge.subscribe(...)
```

The event channel format is always `ipcora:electron:event:{eventName}`.

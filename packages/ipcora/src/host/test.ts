import type { Promisable } from 'type-fest';

import type { InferDefinition } from '../client';
import type { AnyIpcora } from './index';
import type { IpcAdapter, IpcEvent, IpcInvoke, IpcPeer, IpcResponse, IpcResult } from './types';

export type { Promisable };

export interface MemoryAdapter {
  adapter: IpcAdapter;
  handlers: Map<string, (event: IpcEvent, invoke: IpcInvoke) => Promisable<IpcResponse>>;
  emitted: { channel: string; sender: { id: number }; payload: unknown }[];
}

/**
 * Creates an in-memory IPC adapter for testing.
 *
 * The returned adapter stores registered handlers in a Map and logs emitted
 * events to an array. This is useful for unit testing routers without a real
 * transport layer.
 */
export function createMemoryAdapter(): MemoryAdapter {
  const handlers = new Map<
    string,
    (event: IpcEvent, invoke: IpcInvoke) => Promisable<IpcResponse>
  >();
  const emitted: { channel: string; sender: { id: number }; payload: unknown }[] = [];

  const adapter: IpcAdapter = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    emit(channel, sender, payload) {
      emitted.push({ channel, sender: sender as { id: number }, payload });
    },
    listenerCount(channel) {
      return handlers.has(channel) ? 1 : 0;
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
  };

  return { handlers, emitted, adapter };
}

export interface CreateCallerOptions {
  /**
   * Test peer used to identify the caller.
   * @default `{ sender: { id: 1 } }`
   */
  peer?: IpcPeer;
}

/**
 * InvokeClient type — mirrors the client-side proxy shape for handlers.
 */
type InvokeClient<T> = T extends (...args: any[]) => any
  ? Parameters<T> extends []
    ? () => Promise<IpcResult<Awaited<ReturnType<T>>>>
    : (
        ...args: [...params: Parameters<T>, metadata?: Record<string, unknown>]
      ) => Promise<IpcResult<Awaited<ReturnType<T>>>>
  : T extends object
    ? { [K in keyof T]: InvokeClient<T[K]> }
    : never;

/**
 * Creates a typed test caller from an existing Ipcora router.
 *
 * The returned proxy mirrors the router's route structure and lets you invoke
 * handlers directly — without a transport, adapter, or peer setup. Each call
 * exercises the full lifecycle (hooks, validation, guards, error handling).
 *
 * @example
 * ```ts
 * const ipc = ipcora().handler('ping', () => 'pong');
 * const caller = createCaller(ipc);
 * const result = await caller.ping(); // → { data: 'pong', error: null }
 * ```
 */
export function createCaller<TIpc extends AnyIpcora>(
  ipc: TIpc,
  options?: CreateCallerOptions,
): InvokeClient<InferDefinition<TIpc>['handlers']> {
  const memory = createMemoryAdapter();

  // Inject adapter into the router if not already set.
  const ipcAny = ipc as unknown as {
    options: Record<string, unknown>;
    channel: string;
    bind: AnyIpcora['bind'];
  };
  if (!ipcAny.options.adapter) {
    ipcAny.options.adapter = memory.adapter;
  }

  // Bind a test peer so dispatch() resolves bindings.
  const testPeer: IpcPeer = options?.peer ?? { sender: { id: 1 } };
  ipc.bind(testPeer);

  // After bind() + installAdapter(), the memory adapter has stored the
  // dispatch handler under the IPC channel.
  const handler = memory.handlers.get(ipc.channel);
  if (!handler) {
    throw new Error(
      'Ipcora test adapter not installed. Ensure the router is not abstract and bind() was called.',
    );
  }

  let seq = 0;
  const invoke = (path: string[], args: unknown[], metadata?: Record<string, unknown>) => {
    seq += 1;
    return handler(
      { sender: testPeer.sender },
      {
        id: `test:${seq}`,
        path: path.join('.'),
        params: args[0],
        metadata,
      },
    ) as Promise<IpcResponse>;
  };

  return createCallerProxy(invoke, []) as unknown as InvokeClient<
    InferDefinition<TIpc>['handlers']
  >;
}

// Proxy helpers

function createCallerProxy(
  invoke: (
    path: string[],
    args: unknown[],
    metadata?: Record<string, unknown>,
  ) => Promise<IpcResponse>,
  path: string[],
): unknown {
  const target = function callerTarget() {};

  return new Proxy(target, {
    get(_target, property) {
      if (property === 'then') return undefined;
      if (property === Symbol.toStringTag) return 'IpcoraTestCaller';
      if (typeof property !== 'string') return undefined;
      return createCallerProxy(invoke, [...path, property]);
    },
    apply(_target, _thisArg, args) {
      if (path.length === 0) {
        throw new TypeError(
          'The root test caller cannot be called directly. Access a handler path first.',
        );
      }
      let metadata: Record<string, unknown> | undefined;
      let callArgs: unknown[];
      if (args.length > 1 && isPlainObject(args[args.length - 1])) {
        metadata = args[args.length - 1] as Record<string, unknown>;
        callArgs = args.slice(0, -1);
      } else {
        callArgs = [...args];
      }
      return invoke(path, callArgs, metadata).then(normalizeToIpcResult);
    },
  });
}

function normalizeToIpcResult(response: IpcResponse): IpcResult<unknown> {
  if ('error' in response && response.error) {
    return { data: null, error: response.error };
  }
  return { data: response.data, error: null } as IpcResult<unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

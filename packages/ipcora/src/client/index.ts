import type { Promisable, Simplify, UnknownRecord } from 'type-fest';

import type {
  AnySchema,
  DefinedEvents,
  DefinedEventsDefinition,
  IpcErrorPayload,
} from '../host/types';
import { isSchema } from '../utils';
export { ClientIpcError } from './error';
import { ClientIpcError } from './error';
import { parseSchema } from './utils';

export type { Promisable, Simplify, UnknownRecord };

type AnyFunction = (...args: any[]) => any;
export type InferDefinition<T extends { readonly ['~definition']: object }> = T['~definition'];
type ResultOf<T> =
  Awaited<T> extends { data: unknown; error: unknown }
    ? Awaited<T>
    : { data: Awaited<T>; error: null };
type DataOf<T> =
  Awaited<T> extends infer TValue
    ? TValue extends { data: infer TData; error: null }
      ? TData
      : TValue extends { data: infer TData; error?: undefined }
        ? TData
        : TValue extends { data: infer TData; error: unknown }
          ? Exclude<TData, null>
          : TValue
    : never;
type InvokeResult<T, TThrowInvokeError extends boolean> = TThrowInvokeError extends true
  ? DataOf<T>
  : ResultOf<T>;

export type ClientMetadata = UnknownRecord;
export type Unsubscribe = () => void;
export type EventListener<TPayload> = (payload: TPayload) => void;
export interface EventSubscriber<TPayload> {
  (listener: EventListener<TPayload>): Unsubscribe;
}
export type InvokeClient<T, TThrowInvokeError extends boolean = false> = T extends AnyFunction
  ? Parameters<T> extends []
    ? () => Promise<InvokeResult<ReturnType<T>, TThrowInvokeError>>
    : (
        ...args: [...Parameters<T>, metadata?: ClientMetadata]
      ) => Promise<InvokeResult<ReturnType<T>, TThrowInvokeError>>
  : T extends object
    ? { [K in keyof T]: InvokeClient<T[K], TThrowInvokeError> }
    : never;

export type EventClient<T> = T extends object
  ? {
      [K in keyof T]: T[K] extends {
        readonly __ipcoraEvent: true;
        readonly payload: infer TPayload;
      }
        ? EventSubscriber<TPayload>
        : T[K] extends object
          ? EventClient<T[K]>
          : never;
    }
  : never;

export interface Client<
  TDefinition extends { handlers: object; events: object },
  TThrowInvokeError extends boolean = false,
> {
  invoke: Simplify<InvokeClient<TDefinition['handlers'], TThrowInvokeError>>;
  event: Simplify<EventClient<TDefinition['events']>>;
}

export interface ClientCall {
  /**
   * Full path segments.
   *
   * @example ["window", "raw", "move"]
   */
  path: string[];

  /**
   * Joined IPC channel name.
   *
   * @example "window.raw.move"
   */
  channel: string;

  /**
   * Namespace containing the method.
   *
   * @example "window.raw"
   */
  namespace: string;

  /**
   * Final method name being called.
   *
   * @example "move"
   */
  method: string;

  /**
   * Call arguments (params only, metadata is separated by the proxy).
   */
  args: unknown[];

  /**
   * Merged metadata. The proxy resolves this from static config,
   * `onInvoke` hooks, and per-call metadata before invoking.
   */
  metadata?: ClientMetadata;
}

export type ClientInvokeCall = Omit<ClientCall, 'metadata'> & {
  metadata: Readonly<ClientMetadata>;
};

export type ClientInvokeHook = (
  call: ClientInvokeCall,
) => Promisable<{ metadata?: ClientMetadata } | void>;

export interface ClientHooks {
  onInvoke?: ClientInvokeHook[];
}

export interface IpcClientAdapter {
  invoke(call: ClientCall): unknown | Promise<unknown>;
  subscribe?(call: ClientSubscription): Unsubscribe;
}

type ClientDefinitionFromEvents<TEvents> = {
  handlers: {};
  events: TEvents extends DefinedEvents<any, any> ? DefinedEventsDefinition<TEvents> : {};
};

export interface IpcoraClientOptions<
  TEvents extends DefinedEvents<any, any> | undefined = undefined,
  TThrowInvokeError extends boolean = boolean,
> {
  /**
   * Transport adapter used by the client proxy.
   */
  adapter: IpcClientAdapter;

  /**
   * IPC channel prefix used to compute event subscription channels.
   * Must match the `channel` passed to the server-side `ipcora({ channel })`.
   *
   * @default 'ipcora:invoke'
   */
  channel?: string;

  /** Static metadata merged into every call (lowest priority). */
  metadata?: ClientMetadata;

  /** Client-side hooks. */
  hooks?: ClientHooks;

  /**
   * Throw an `Error` when the transport returns an invoke error.
   *
   * @default false
   */
  throwInvokeError?: TThrowInvokeError;

  /**
   * Shared event contract created by `defineEvents(...)`.
   * The client validates delivered event payloads with each schema output
   * before calling listeners.
   */
  eventSchema?: TEvents;
}

export interface ClientSubscription {
  event: string;
  channel: string;
  once: boolean;
  schema?: AnySchema;
  listener: (payload: unknown) => void;
}

export function ipcoraClient<
  const TEvents extends DefinedEvents<any, any>,
  const TThrowInvokeError extends boolean = false,
>(
  options: IpcoraClientOptions<TEvents, TThrowInvokeError>,
): Client<ClientDefinitionFromEvents<TEvents>, TThrowInvokeError>;
export function ipcoraClient<
  TDefinition extends { handlers: object; events: object } = { handlers: {}; events: {} },
>(
  options: IpcoraClientOptions<undefined, true> & { throwInvokeError: true },
): Client<TDefinition, true>;
export function ipcoraClient<
  TDefinition extends { handlers: object; events: object } = { handlers: {}; events: {} },
  const TThrowInvokeError extends boolean = false,
>(
  options: IpcoraClientOptions<undefined, TThrowInvokeError>,
): Client<TDefinition, TThrowInvokeError>;
export function ipcoraClient<
  TDefinition extends { handlers: object; events: object } = { handlers: {}; events: {} },
>(
  options: IpcoraClientOptions<undefined, boolean> & { throwInvokeError?: boolean },
): Client<TDefinition, boolean>;
export function ipcoraClient(options: IpcoraClientOptions<any>): Client<any> {
  const eventSchemas = options.eventSchema ? flattenEventSchemas(options.eventSchema) : undefined;
  const invokeHooks = options.hooks?.onInvoke ?? [];

  return {
    invoke: createInvokeProxy({
      path: [],
      invoke: options.adapter.invoke,
      staticMetadata: options.metadata,
      onInvoke: invokeHooks,
      throwInvokeError: options.throwInvokeError ?? false,
    }),
    event: createEventProxy({
      path: [],
      subscribe: options.adapter.subscribe,
      channel: options.channel ?? 'ipcora:invoke',
      schemas: eventSchemas,
    }),
  } as Client<any>;
}

interface InvokeProxyContext {
  path: string[];
  invoke: IpcClientAdapter['invoke'];
  staticMetadata?: ClientMetadata;
  onInvoke?: ClientInvokeHook[];
  throwInvokeError: boolean;
}

interface EventProxyContext {
  path: string[];
  subscribe?: IpcClientAdapter['subscribe'];
  channel: string;
  schemas?: ReadonlyMap<string, AnySchema>;
}

function createInvokeProxy(context: InvokeProxyContext): unknown {
  const target = function clientProxyTarget() {};

  return new Proxy(target, {
    get(_target, property) {
      if (property === 'then') {
        return undefined;
      }

      if (property === Symbol.toStringTag) {
        return 'IpcoraClient';
      }

      if (property === Symbol.for('nodejs.util.inspect.custom')) {
        return () => {
          const channel = context.path.join('.');

          return channel ? `[IpcoraClient ${channel}]` : '[IpcoraClient]';
        };
      }

      if (typeof property !== 'string') {
        return undefined;
      }

      return createInvokeProxy({
        path: [...context.path, property],
        invoke: context.invoke,
        staticMetadata: context.staticMetadata,
        onInvoke: context.onInvoke,
        throwInvokeError: context.throwInvokeError,
      });
    },

    apply(_target, _thisArg, args) {
      if (context.path.length === 0) {
        throw new TypeError('The root client cannot be called directly');
      }

      const method = context.path.at(-1)!;
      const namespace = context.path.slice(0, -1).join('.');
      const channel = context.path.join('.');

      let callArgs: unknown[];
      let perCallMetadata: ClientMetadata | undefined;

      perCallMetadata =
        args.length > 1 && isPlainObject(args.at(-1)) ? (args.at(-1) as ClientMetadata) : undefined;
      callArgs = perCallMetadata ? args.slice(0, -1) : [...args];

      const call: ClientCall = {
        path: [...context.path],
        channel,
        namespace,
        method,
        args: callArgs,
      };

      return resolveMetadata(context, call, perCallMetadata).then(mergedMetadata => {
        if (mergedMetadata) {
          call.metadata = mergedMetadata;
        }
        return Promise.resolve(context.invoke(call)).then(value =>
          normalizeResult(value, context.throwInvokeError),
        );
      });
    },
  });
}

function createEventSubscriber(
  eventMethod: string,
  context: Omit<EventProxyContext, 'path'>,
): (listener: (payload: unknown) => void) => Unsubscribe {
  return listener => {
    const { subscribe } = context;
    if (!subscribe) {
      throw new TypeError('Client subscribe adapter is required for IPC events');
    }

    const { event, channel, once } = parseEventMethod(eventMethod, context.channel);
    const schema = context.schemas?.get(event);
    let unsubscribe: Unsubscribe = () => {};
    const callListener = (payload: unknown) => {
      if (!schema) {
        listener(payload);
        return;
      }
      void parseSchema(schema, payload).then(listener);
    };
    const wrappedListener = once
      ? (payload: unknown) => {
          unsubscribe();
          callListener(payload);
        }
      : callListener;

    unsubscribe = subscribe({
      event,
      channel,
      once,
      schema,
      listener: wrappedListener,
    });
    return unsubscribe;
  };
}

function createEventProxy(context: EventProxyContext): unknown {
  const target = function clientEventProxyTarget() {};

  return new Proxy(target, {
    get(_target, property) {
      if (property === 'then') {
        return undefined;
      }

      if (property === Symbol.toStringTag) {
        return 'IpcoraEventClient';
      }

      if (typeof property !== 'string') {
        return undefined;
      }

      const path = [...context.path, property];
      if (isEventMethod(property)) {
        return createEventSubscriber(path.join('.'), context);
      }

      return createEventProxy({
        path,
        subscribe: context.subscribe,
        channel: context.channel,
        schemas: context.schemas,
      });
    },

    apply() {
      throw new TypeError(
        `"${formatPath(context.path)}" is an event namespace and cannot be called`,
      );
    },
  });
}

function flattenEventSchemas(events: Record<string, unknown>): Map<string, AnySchema> {
  const schemas = new Map<string, AnySchema>();

  const visit = (node: Record<string, unknown>, prefix?: string) => {
    for (const [name, value] of Object.entries(node)) {
      const event = prefix ? `${prefix}.${name}` : name;
      if (isSchema(value)) {
        schemas.set(event, value);
        continue;
      }

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        visit(value as Record<string, unknown>, event);
      }
    }
  };

  visit(events);
  return schemas;
}

function isEventMethod(value: string): boolean {
  return /^on(?:Once)?[A-Z]/.test(value);
}

function parseEventMethod(
  eventMethod: string,
  ipcChannel: string,
): {
  event: string;
  channel: string;
  once: boolean;
} {
  const segments = eventMethod.split('.');
  const method = segments.at(-1)!;
  const once = method.startsWith('onOnce');
  const prefixLength = once ? 'onOnce'.length : 'on'.length;
  const eventName = uncapitalize(method.slice(prefixLength));
  const namespace = segments.slice(0, -1).join('.');
  const event = namespace ? `${namespace}.${eventName}` : eventName;

  return {
    event,
    channel: `${ipcChannel}:event:${event}`,
    once,
  };
}

function normalizeResult(value: unknown, throwInvokeError: boolean): unknown {
  if (isResult(value)) {
    if (throwInvokeError && value.error) throw createClientInvokeError(value.error);
    if (throwInvokeError) return value.data;
    return value;
  }

  if (isWireResponse(value)) {
    if ('error' in value) {
      if (throwInvokeError) throw createClientInvokeError(value.error);
      return { data: null, error: value.error };
    }
    if (throwInvokeError) return value.data;
    return { data: value.data, error: null };
  }

  return { data: value, error: null };
}

function createClientInvokeError(error: unknown): ClientIpcError {
  if (isIpcErrorPayload(error)) {
    return new ClientIpcError(error.name, {
      message: error.message,
      stack: error.stack,
    });
  }

  return new ClientIpcError('IPC_INVOKE_ERROR', {
    message: 'IPC invoke failed',
  });
}

function isWireResponse(
  value: unknown,
): value is { data: unknown; error?: undefined } | { data?: undefined; error: unknown } {
  return value !== null && typeof value === 'object' && ('data' in value || 'error' in value);
}

function isResult(value: unknown): value is { data: unknown; error: unknown } {
  return value !== null && typeof value === 'object' && 'data' in value && 'error' in value;
}

function isIpcErrorPayload(value: unknown): value is IpcErrorPayload {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as IpcErrorPayload).name === 'string' &&
    typeof (value as IpcErrorPayload).message === 'string'
  );
}

function formatPath(path: string[]): string {
  return path.length > 0 ? path.join('.') : '<root>';
}

function uncapitalize(value: string): string {
  return value.length > 0 ? `${value[0]!.toLowerCase()}${value.slice(1)}` : value;
}

async function resolveMetadata(
  context: InvokeProxyContext,
  call: Omit<ClientCall, 'metadata'>,
  perCallMetadata?: ClientMetadata,
): Promise<ClientMetadata | undefined> {
  // Start with static metadata (lowest priority)
  let merged: ClientMetadata = { ...context.staticMetadata };

  // Apply invoke hooks in declaration order.
  for (const hook of context.onInvoke ?? []) {
    const hookResult = await hook({ ...call, metadata: Object.freeze({ ...merged }) });
    if (hookResult?.metadata && typeof hookResult.metadata === 'object') {
      merged = { ...merged, ...hookResult.metadata };
    }
  }

  // Apply per-call metadata (highest priority)
  if (perCallMetadata) {
    merged = { ...merged, ...perCallMetadata };
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function isPlainObject(value: unknown): value is ClientMetadata {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

import type { AbstractConstructor, Promisable, Simplify, UnknownRecord } from 'type-fest';

import type {
  EventEmitter,
  EventInputByName,
  EventNames,
  EventTreeDefinitions,
} from '../event/types';
import type { fail, IpcError } from './errors';

export type * from '../event/types';
export type * from '../type-system';
export type * from './type-system';

export type { AbstractConstructor, Promisable, Simplify, UnknownRecord };

/**
 * Router configuration and lifecycle phases.
 */
export type PluginScope = 'local' | 'scoped';

/**
 * Named execution phases used when reporting errors to `onError` hooks.
 */
export type LifecyclePhase =
  | 'onInvoke'
  | 'onTransform'
  | 'derive'
  | 'validation'
  | 'resolve'
  | 'onGuard'
  | 'onBeforeHandle'
  | 'handler'
  | 'onAfterHandle'
  | 'onMapResponse'
  | 'onError'
  | 'onAfterResponse'
  | 'onTrace';

export type IpcTracePhase = Exclude<LifecyclePhase, 'onTrace'>;

export interface IpcTraceSpan {
  phase: IpcTracePhase;
  duration: number;
}

/**
 * Wire protocol payloads exchanged by adapters.
 */
export interface IpcInvoke {
  id: string;
  path: string;
  params?: unknown;
  metadata?: UnknownRecord;
}

/**
 * Wire response returned by the main process dispatcher.
 */
export type IpcResponse<T = unknown> =
  | { data: T; error?: undefined }
  | { data?: undefined; error: IpcErrorPayload };

export type IpcErrorPayload<TName extends string = string, TData = unknown> = {
  name: TName;
  message: string;
  data?: TData;
  stack?: string;
};

export type BuiltInErrorPayload =
  | IpcErrorPayload<'PEER_NOT_BOUND'>
  | IpcErrorPayload<'HANDLER_NOT_FOUND'>
  | IpcErrorPayload<'VALIDATION_ERROR'>
  | IpcErrorPayload<'INTERNAL_SERVER_ERROR'>;

export type IpcResult<TData, TError = IpcErrorPayload> =
  | { data: Awaited<TData>; error: null }
  | { data: null; error: TError };

/**
 * Error registry declarations used by router-level error mapping.
 */
export type ErrorRegistry = Record<string, AbstractConstructor<Error>>;

export type ErrorMapper<
  TError extends Error = Error,
  TMapped extends IpcError = IpcError,
> = (value: { fail: typeof fail; error: TError }) => TMapped;

/**
 * Minimal Standard Schema v1 shape. Libraries such as ArkType, Zod, Valibot,
 * and TypeBox adapters can be consumed through this shared contract.
 */
export interface StandardSchemaV1<TParams = unknown, TOutput = TParams> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => Promisable<
      | { value: TOutput; issues?: undefined }
      | { issues: readonly { message: string; path?: readonly unknown[] }[] }
    >;
    readonly types?: {
      readonly input: TParams;
      readonly output: TOutput;
    };
  };
}

export type AnySchema = StandardSchemaV1<any, any>;
export type EventSchema = Record<string, AnySchema>;

/**
 * Runtime marker placed on generated event subscription definitions.
 */
export interface EventDefinition<
  TName extends string = string,
  TInput = unknown,
  TPayload = TInput,
> {
  (listener: (payload: TPayload) => void): () => void;
  readonly __ipcoraEvent: true;
  readonly name: TName;
  readonly channel: string;
  readonly once: boolean;
  readonly input: TInput;
  readonly payload: TPayload;
}

export interface DefinedEvents<
  TSchema extends Record<string, unknown>,
  TDefinition extends object = EventTreeDefinitions<TSchema>,
> {
  readonly ['~definition']: {
    readonly handlers: {};
    readonly events: TDefinition;
    readonly schema: TSchema;
  };
}

export interface EventEmitOptions {
  peers?: Iterable<IpcPeer | number>;
}

/**
 * Adapter-facing peer and transport declarations.
 */
export interface IpcSender {
  id: number;
}

/**
 * Minimal event shape passed from an adapter to the router.
 */
export interface IpcEvent<TSender extends IpcSender = IpcSender> {
  sender: TSender;
}

/**
 * Adapter object used to install and remove invoke handlers for a platform.
 */
export interface IpcAdapter<TEvent extends IpcEvent = IpcEvent> {
  handle(
    channel: string,
    handler: (event: TEvent, invoke: IpcInvoke) => Promisable<IpcResponse>,
  ): void;
  emit(channel: string, sender: TEvent['sender'], payload: unknown): Promisable<void>;
  listenerCount(channel: string): number;
  removeHandler(channel: string): void;
}

/**
 * A bound caller allowed to dispatch requests through this router.
 */
export interface IpcPeer<TSender extends IpcSender = IpcSender> {
  sender: TSender;
  onDispose?: (dispose: () => void) => void;
}

/**
 * Context surface exposed to handlers and lifecycle hooks.
 */
export type ContextEmit<TEvents extends object> = <
  const TName extends EventNames<TEvents> & string,
>(
  name: TName,
  payload: EventInputByName<TEvents, TName>,
  options?: EventEmitOptions,
) => Promise<void>;

export type RuntimeContext<
  TContext extends object,
  TStore extends object,
  TEvents extends object = {},
> = Simplify<
  TContext & {
    store: TStore;
    peer: IpcPeer;
    sender: IpcSender;
    event: IpcEvent;
    emit: ContextEmit<TEvents>;
    $emit: EventEmitter<TEvents>;
  }
>;

/**
 * Fields shared by every lifecycle hook.
 */
export type LifecycleBase<
  TContext extends object,
  TStore extends object,
  TEvents extends object = {},
> = RuntimeContext<TContext, TStore, TEvents> & {
  id: string;
  path: string;
  signal: AbortSignal;
  startedAt: number;
  metadata: Readonly<UnknownRecord>;
  fail: typeof fail;
};

export type OnInvokeHook<TContext extends object, TStore extends object> = (
  value: LifecycleBase<TContext, TStore> & { invoke: IpcInvoke; rawParams: unknown },
) => Promisable<void>;

export type OnTransformHook<TContext extends object, TStore extends object> = (
  value: LifecycleBase<TContext, TStore> & { params: unknown },
) => Promisable<unknown | void>;

export type DeriveHook<TContext extends object, TStore extends object> = (
  value: LifecycleBase<TContext, TStore> & { params: unknown; rawParams: unknown },
) => Promisable<object | void>;

export type ResolveHook<TContext extends object, TStore extends object> = (
  value: LifecycleBase<TContext, TStore> & { params: unknown; rawParams: unknown },
) => Promisable<object | void>;

export type OnGuardHook<TContext extends object, TStore extends object> = (
  value: LifecycleBase<TContext, TStore> & { params: unknown },
) => Promisable<object | void>;

export type OnBeforeHandleHook<TContext extends object, TStore extends object> = (
  value: LifecycleBase<TContext, TStore> & { params: unknown },
) => Promisable<void>;

export type OnAfterHandleHook<TContext extends object, TStore extends object> = (
  value: LifecycleBase<TContext, TStore> & { params: unknown; response: unknown },
) => Promisable<unknown | void>;

export type OnMapResponseHook<TContext extends object, TStore extends object> = (
  value: LifecycleBase<TContext, TStore> & {
    params: unknown;
    handlerResponse: unknown;
    response: IpcResponse;
  },
) => Promisable<IpcResponse | void>;

export type OnErrorHook<TContext extends object, TStore extends object> = (
  value: LifecycleBase<TContext, TStore> & {
    params: unknown;
    rawParams: unknown;
    cause: unknown;
    name: string;
    error: IpcError;
    phase: LifecyclePhase;
  },
) => Promisable<IpcResponse | IpcError | void>;

export type OnAfterResponseHook<TContext extends object, TStore extends object> = (
  value: LifecycleBase<TContext, TStore> & {
    params: unknown;
    handlerResponse: unknown;
    response: IpcResponse;
    cause: unknown;
    phase: LifecyclePhase;
    success: boolean;
    duration: number;
  },
) => Promisable<void>;

export type OnTraceHook<TContext extends object, TStore extends object> = (
  value: LifecycleBase<TContext, TStore> & {
    params: unknown;
    handlerResponse: unknown;
    response: IpcResponse;
    cause: unknown;
    success: boolean;
    duration: number;
    endedAt: number;
    spans: readonly IpcTraceSpan[];
  },
) => Promisable<void>;

/**
 * The value received by a route handler.
 */
export type HandlerContext<
  TParams,
  TContext extends object,
  TStore extends object,
  TEvents extends object = {},
> = LifecycleBase<TContext, TStore, TEvents> & {
  params: TParams;
};

export type HandlerFunction<
  TParams,
  TResponse,
  TContext extends object,
  TStore extends object,
  TEvents extends object = {},
> = (value: HandlerContext<TParams, TContext, TStore, TEvents>) => TResponse | Promise<TResponse>;

export interface HookStore<TContext extends object, TStore extends object> {
  onInvoke: OnInvokeHook<TContext, TStore>[];
  onTransform: OnTransformHook<TContext, TStore>[];
  derive: DeriveHook<TContext, TStore>[];
  resolve: ResolveHook<TContext, TStore>[];
  onGuard: OnGuardHook<TContext, TStore>[];
  onBeforeHandle: OnBeforeHandleHook<TContext, TStore>[];
  onAfterHandle: OnAfterHandleHook<TContext, TStore>[];
  onMapResponse: OnMapResponseHook<TContext, TStore>[];
  onError: OnErrorHook<TContext, TStore>[];
  onAfterResponse: OnAfterResponseHook<TContext, TStore>[];
  onTrace: OnTraceHook<TContext, TStore>[];
}

/**
 * Macro and handler declarations.
 *
 * A macro describes one custom handler option. When a handler uses that
 * option, matching lifecycle hooks are appended to the route.
 */
export interface MacroDefinition<
  TContext extends object,
  TStore extends object,
  TOption,
  TExtension extends object = {},
> {
  seed?: unknown;
  params?: AnySchema;
  response?: AnySchema;
  onInvoke?: MacroHook<OnInvokeHook<TContext, TStore>, TOption>;
  onTransform?: MacroHook<OnTransformHook<TContext, TStore>, TOption>;
  derive?: MacroHook<DeriveHook<TContext, TStore>, TOption>;
  resolve?: MacroHook<ResolveHook<TContext, TStore>, TOption, TExtension>;
  onGuard?: MacroHook<OnGuardHook<TContext, TStore>, TOption, TExtension>;
  onBeforeHandle?: MacroHook<OnBeforeHandleHook<TContext, TStore>, TOption>;
  onAfterHandle?: MacroHook<OnAfterHandleHook<TContext, TStore>, TOption>;
  onMapResponse?: MacroHook<OnMapResponseHook<TContext, TStore>, TOption>;
  onError?: MacroHook<OnErrorHook<TContext, TStore>, TOption>;
  onAfterResponse?: MacroHook<OnAfterResponseHook<TContext, TStore>, TOption>;
  onTrace?: MacroHook<OnTraceHook<TContext, TStore>, TOption>;
}

export type MacroFactory<
  TContext extends object,
  TStore extends object,
  TOption,
  TDefinition extends MacroDefinition<TContext, TStore, TOption, any> | void = MacroDefinition<
    TContext,
    TStore,
    TOption,
    any
  > | void,
> = (option: TOption) => Promisable<TDefinition>;

export type MacroHook<THook, TOption, TReturn extends object = object> = THook extends (
  value: infer TValue,
) => Promisable<infer TResult>
  ? (value: TValue & { option: TOption }) => Promisable<TResult | TReturn>
  : never;

export type AnyMacroDefinition = MacroDefinition<any, any, any, any>;
export type AnyMacroFactory = MacroFactory<any, any, any, AnyMacroDefinition | void>;
export type AnyMacroEntry = AnyMacroDefinition | AnyMacroFactory;
export type MacroRegistry = Record<string, AnyMacroEntry>;

/**
 * Built-in handler options. Macro options are merged into this shape by
 * `HandlerOptions`.
 */
export interface BuiltInHandlerOptions<
  TParamsSchema extends AnySchema | undefined = undefined,
  TResponseSchema extends AnySchema | undefined = undefined,
  TMetadataSchema extends AnySchema | undefined = undefined,
  TContext extends object = object,
  TStore extends object = object,
> {
  params?: TParamsSchema;
  response?: TResponseSchema;
  validateResponse?: boolean;
  metadata?: TMetadataSchema;
  onInvoke?: OnInvokeHook<TContext, TStore>;
  onTransform?: OnTransformHook<TContext, TStore>;
  derive?: DeriveHook<TContext, TStore>;
  resolve?: ResolveHook<TContext, TStore>;
  onGuard?: OnGuardHook<TContext, TStore>;
  onBeforeHandle?: OnBeforeHandleHook<TContext, TStore>;
  onAfterHandle?: OnAfterHandleHook<TContext, TStore>;
  onMapResponse?: OnMapResponseHook<TContext, TStore>;
  onError?: OnErrorHook<TContext, TStore>;
  onAfterResponse?: OnAfterResponseHook<TContext, TStore>;
  onTrace?: OnTraceHook<TContext, TStore>;
}

export interface HandlerDefinition<
  TContext extends object,
  TStore extends object,
  TEvents extends object = {},
> {
  path: string;
  handler: HandlerFunction<any, any, TContext, TStore, TEvents>;
  paramsSchema?: AnySchema;
  responseSchema?: AnySchema;
  validateResponse: boolean;
  metadataSchema?: AnySchema;
  hooks: HookStore<TContext, TStore>;
}

export interface Binding {
  peer: IpcPeer;
  controller: AbortController;
}

export interface IpcoraOptions {
  /**
   * Unique name for this router. When set, prevents another router with the
   * same name from installing an adapter (deduplication guard).
   */
  name?: string;
  /**
   * Optional plugin identity salt. Combined with `name` when deduplicating a
   * named plugin inside a parent router.
   */
  seed?: string | number;
  /**
   * When `true`, handler registrations only contribute at the type level —
   * no routes are actually registered and no adapter is installed. Useful
   * for composing type-only routers that share schemas without wiring up
   * runtime handlers.
   */
  abstract?: boolean;
  channel?: string;
  adapter?: IpcAdapter;
  exposeStack?: boolean;
  validateResponse?: boolean;
  /**
   * When `false`, skips schema validation of event payloads in `emit()`.
   * Defaults to `true`.
   */
  validateEvents?: boolean;
  onAfterResponseError?: (error: unknown, path: string) => void;
}

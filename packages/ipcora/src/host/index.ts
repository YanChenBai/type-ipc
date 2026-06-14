export { fail, IpcError } from './errors';
export type * from './types';

import type { AbstractConstructor, Promisable, Simplify, UnknownRecord } from 'type-fest';

import { isSchema } from '../utils';
import { fail, IpcError } from './errors';
import type {
  AnyMacroDefinition,
  AnyMacroEntry,
  AnySchema,
  Binding,
  BuiltInHandlerOptions,
  DeriveHook,
  DefinedEvents,
  DefinedEventsDefinition,
  EventEmitOptions,
  EventEmitter,
  EventInputByName,
  EventNames,
  ErrorMapPayload,
  ErrorMapper,
  ErrorRegistry,
  ErrorRegistryPayload,
  HandlerDefinition,
  HandlerFunction,
  HandlerOptions,
  HookReturnExtension,
  HookStore,
  InferSchemaInput,
  InferSchemaOutput,
  IpcEvent,
  IpcTracePhase,
  IpcTraceSpan,
  IpcoraOptions,
  IpcPeer,
  IpcInvoke,
  IpcResponse,
  JoinPathType,
  LifecycleBase,
  LifecyclePhase,
  MacroDefinition,
  MacroDefinitionExtension,
  MacroDefinitionOption,
  MacroObjectExtension,
  MacroObjectRegistry,
  MacroRegistry,
  Merge,
  NormalizeMacroOption,
  OnAfterHandleHook,
  OnAfterResponseHook,
  OnBeforeHandleHook,
  OnErrorHook,
  OnErrorHookPayload,
  OnGuardHook,
  OnMapResponseHook,
  OnInvokeHook,
  OnTraceHook,
  OnTransformHook,
  PathToObject,
  PluginScope,
  ResolveHook,
  RouteHandler,
  RuntimeContext,
} from './types';
import {
  builtInHandlerOptionKeys,
  cloneHooks,
  emptyHooks,
  joinPath,
  normalizeObjectParams,
  parseSchema,
} from './utils';

export type { AbstractConstructor, Promisable, Simplify, UnknownRecord };

const isDevMode = (): boolean => {
  try {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') return true;
  } catch {
    /* noop */
  }
  return false;
};

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function createEventEmitter(ipcora: AnyIpcora, path = ''): unknown {
  const emit = (payload: unknown, options?: EventEmitOptions) =>
    ipcora.emit(path, payload, options);

  return new Proxy(emit, {
    get(_target, property) {
      if (property === 'then') {
        return undefined;
      }

      if (property === Symbol.toStringTag) {
        return 'IpcoraEventEmitter';
      }

      if (typeof property !== 'string' || property.includes('.')) {
        return undefined;
      }

      return createEventEmitter(ipcora, path ? `${path}.${property}` : property);
    },
  });
}

/**
 * IPC router. It owns route registration, lifecycle execution, adapter
 * binding, macros, adapters, and Elysia-style context extension.
 */
export class Ipcora<
  TContext extends object = {},
  TStore extends object = {},
  TMacros extends MacroRegistry = {},
  TRoutes extends object = {},
  TPrefix extends string = '',
  TErrors = never,
  TEvents extends object = {},
  THandlers extends object = {},
> {
  /** IPC channel name used by the adapter. */
  readonly channel: string;

  /** Unique name for this router, used to prevent duplicate adapter installation. */
  readonly name?: string;

  /** When `true`, only type-level definitions are contributed; no runtime routes or adapter. */
  readonly abstract: boolean;

  readonly manifest: TRoutes;

  readonly $emit: EventEmitter<TEvents>;

  /** Type-level protocol accessor (mirrors Standard Schema `~standard` pattern). */
  declare readonly ['~definition']: {
    readonly handlers: THandlers;
    readonly events: TEvents;
  };

  /** Tracks which named routers have been installed to guard against double-binding. */
  private static readonly installedNames = new Set<string>();

  private readonly routes: Map<string, HandlerDefinition<any, any, any>>;
  private readonly eventSchemas: Map<string, AnySchema>;
  private readonly bindings: Map<number, Binding>;
  private readonly options: Required<Pick<IpcoraOptions, 'exposeStack'>> & IpcoraOptions;
  private readonly macros: Map<string, AnyMacroEntry>;
  private readonly errorMappers: Map<AbstractConstructor<Error>, (error: Error) => IpcError>;
  private readonly usedPlugins: Set<string>;
  private prefix = '';
  private hooks: HookStore<any, any>;
  private decorators: UnknownRecord = {};
  private store: UnknownRecord = {};
  private scope: PluginScope = 'local';
  private installed = false;

  constructor(options: IpcoraOptions = {}) {
    this.channel = options.channel ?? 'ipcora:invoke';
    this.name = options.name;
    this.abstract = options.abstract ?? false;
    this.options = {
      exposeStack: isDevMode(),
      validateResponse: true,
      validateEvents: true,
      ...options,
    };
    this.routes = new Map();
    this.eventSchemas = new Map();
    this.bindings = new Map();
    this.macros = new Map();
    this.errorMappers = new Map();
    this.hooks = emptyHooks();
    this.usedPlugins = new Set();
    this.manifest = {} as TRoutes;
    this.$emit = createEventEmitter(this as any) as any;
  }

  private createScope<const TScopePrefix extends string>(
    prefix: TScopePrefix,
  ): Ipcora<TContext, TStore, TMacros, TRoutes, TScopePrefix, TErrors, TEvents, THandlers> {
    const scope = Object.create(Ipcora.prototype) as Ipcora<
      TContext,
      TStore,
      TMacros,
      TRoutes,
      TScopePrefix,
      TErrors,
      TEvents,
      THandlers
    >;
    Object.assign(scope, this, {
      prefix,
      name: this.name,
      abstract: this.abstract,
      hooks: cloneHooks(this.hooks),
      decorators: { ...this.decorators },
      store: this.store,
      scope: this.scope,
      usedPlugins: this.usedPlugins,
    });
    return scope;
  }

  as(scope: PluginScope): this {
    this.scope = scope;
    return this;
  }

  /**
   * Add shared mutable state exposed as `store`.
   */
  state<const TKey extends string, TValue>(
    key: TKey,
    value: TValue,
  ): Ipcora<
    TContext,
    Simplify<TStore & Record<TKey, TValue>>,
    TMacros,
    TRoutes,
    TPrefix,
    TErrors,
    TEvents,
    THandlers
  >;
  state<const TExtension extends object>(
    values: TExtension,
  ): Ipcora<
    TContext,
    Simplify<TStore & TExtension>,
    TMacros,
    TRoutes,
    TPrefix,
    TErrors,
    TEvents,
    THandlers
  >;
  state(
    keyOrObject: string | object,
    value?: unknown,
  ): Ipcora<TContext, any, TMacros, TRoutes, TPrefix, TErrors, TEvents, THandlers> {
    Object.assign(this.store, normalizeObjectParams(keyOrObject, value));
    return this;
  }

  /**
   * Add static properties directly to every lifecycle value.
   */
  decorate<const TKey extends string, TValue>(
    key: TKey,
    value: TValue,
  ): Ipcora<
    Simplify<TContext & Record<TKey, TValue>>,
    TStore,
    TMacros,
    TRoutes,
    TPrefix,
    TErrors,
    TEvents,
    THandlers
  >;
  decorate<const TExtension extends object>(
    values: TExtension,
  ): Ipcora<
    Simplify<TContext & TExtension>,
    TStore,
    TMacros,
    TRoutes,
    TPrefix,
    TErrors,
    TEvents,
    THandlers
  >;
  decorate(
    keyOrObject: string | object,
    value?: unknown,
  ): Ipcora<any, TStore, TMacros, TRoutes, TPrefix, TErrors, TEvents, THandlers> {
    Object.assign(this.decorators, normalizeObjectParams(keyOrObject, value));
    return this;
  }

  /**
   * Run before validation to derive context from raw request data.
   */
  derive<TReturn>(
    hook: (
      value: LifecycleBase<TContext, TStore> & { params: unknown; rawParams: unknown },
    ) => Promisable<TReturn>,
  ): Ipcora<
    Simplify<TContext & HookReturnExtension<TReturn>>,
    TStore,
    TMacros,
    TRoutes,
    TPrefix,
    TErrors,
    TEvents,
    THandlers
  > {
    this.hooks.derive.push(hook as DeriveHook<TContext, TStore>);
    return this as unknown as Ipcora<
      Simplify<TContext & HookReturnExtension<TReturn>>,
      TStore,
      TMacros,
      TRoutes,
      TPrefix,
      TErrors,
      TEvents,
      THandlers
    >;
  }

  /**
   * Run after validation to derive context from parsed params.
   */
  resolve<TReturn>(
    hook: (
      value: LifecycleBase<TContext, TStore> & { params: unknown; rawParams: unknown },
    ) => Promisable<TReturn>,
  ): Ipcora<
    Simplify<TContext & HookReturnExtension<TReturn>>,
    TStore,
    TMacros,
    TRoutes,
    TPrefix,
    TErrors,
    TEvents,
    THandlers
  > {
    this.hooks.resolve.push(hook as ResolveHook<TContext, TStore>);
    return this as unknown as Ipcora<
      Simplify<TContext & HookReturnExtension<TReturn>>,
      TStore,
      TMacros,
      TRoutes,
      TPrefix,
      TErrors,
      TEvents,
      THandlers
    >;
  }

  /**
   * Register a custom handler option that expands into lifecycle hooks.
   */
  macro<const TName extends string, const TEntry extends AnyMacroEntry>(
    name: TName,
    definition: TEntry,
  ): Ipcora<
    Simplify<TContext & MacroDefinitionExtension<TEntry>>,
    TStore,
    Simplify<
      TMacros &
        Record<
          TName,
          TEntry extends (...args: any[]) => any
            ? TEntry
            : MacroDefinition<
                TContext,
                TStore,
                NormalizeMacroOption<MacroDefinitionOption<TEntry>>,
                MacroDefinitionExtension<TEntry>
              >
        >
    >,
    TRoutes,
    TPrefix,
    TErrors,
    TEvents,
    THandlers
  >;

  macro<const TDefinitions extends Record<string, AnyMacroEntry>>(
    definitions: TDefinitions,
  ): Ipcora<
    Simplify<TContext & MacroObjectExtension<TDefinitions>>,
    TStore,
    Simplify<TMacros & MacroObjectRegistry<TContext, TStore, TDefinitions>>,
    TRoutes,
    TPrefix,
    TErrors,
    TEvents,
    THandlers
  >;

  macro(
    nameOrDefinitions: string | Record<string, AnyMacroEntry>,
    definition?: AnyMacroEntry,
  ): Ipcora<any, TStore, any, TRoutes, TPrefix, TErrors, TEvents, THandlers> {
    if (typeof nameOrDefinitions === 'string') {
      this.macros.set(nameOrDefinitions, definition!);
    } else {
      for (const [name, entry] of Object.entries(nameOrDefinitions)) {
        this.macros.set(name, entry);
      }
    }
    return this as Ipcora<any, TStore, any, TRoutes, TPrefix, TErrors, TEvents, THandlers>;
  }

  onInvoke(hook: OnInvokeHook<TContext, TStore>): this {
    this.hooks.onInvoke.push(hook);
    return this;
  }

  /**
   * Run before params validation. Return a value to replace the params.
   */
  onTransform(hook: OnTransformHook<TContext, TStore>): this {
    this.hooks.onTransform.push(hook);
    return this;
  }

  onGuard<TReturn>(
    hook: (value: LifecycleBase<TContext, TStore> & { params: unknown }) => Promisable<TReturn>,
  ): Ipcora<
    Simplify<TContext & HookReturnExtension<TReturn>>,
    TStore,
    TMacros,
    TRoutes,
    TPrefix,
    TErrors,
    TEvents,
    THandlers
  > {
    this.hooks.onGuard.push(hook as OnGuardHook<TContext, TStore>);
    return this as unknown as Ipcora<
      Simplify<TContext & HookReturnExtension<TReturn>>,
      TStore,
      TMacros,
      TRoutes,
      TPrefix,
      TErrors,
      TEvents,
      THandlers
    >;
  }

  onBeforeHandle(hook: OnBeforeHandleHook<TContext, TStore>): this {
    this.hooks.onBeforeHandle.push(hook);
    return this;
  }

  onAfterHandle(hook: OnAfterHandleHook<TContext, TStore>): this {
    this.hooks.onAfterHandle.push(hook);
    return this;
  }

  onMapResponse(hook: OnMapResponseHook<TContext, TStore>): this {
    this.hooks.onMapResponse.push(hook);
    return this;
  }

  onError<THook extends OnErrorHook<TContext, TStore>>(
    hook: THook,
  ): Ipcora<
    TContext,
    TStore,
    TMacros,
    TRoutes,
    TPrefix,
    TErrors | OnErrorHookPayload<THook>,
    TEvents,
    THandlers
  > {
    this.hooks.onError.push(hook);
    return this as unknown as Ipcora<
      TContext,
      TStore,
      TMacros,
      TRoutes,
      TPrefix,
      TErrors | OnErrorHookPayload<THook>,
      TEvents,
      THandlers
    >;
  }

  onAfterResponse(hook: OnAfterResponseHook<TContext, TStore>): this {
    this.hooks.onAfterResponse.push(hook);
    return this;
  }

  onTrace(hook: OnTraceHook<TContext, TStore>): this {
    this.hooks.onTrace.push(hook);
    return this;
  }

  /**
   * Register a plugin (another Ipcora instance) merging its routes, hooks,
   * macros, error mappers, state, and decorators into this router.
   *
   * Named plugins are deduplicated per parent router by `name + seed`.
   * Route/resource conflicts are resolved by the later registration.
   */
  use<TPlugin extends AnyIpcora>(
    plugin: TPlugin,
  ): Ipcora<
    Merge<TContext, TPlugin extends Ipcora<infer TC, any, any, any, any, any, any, any> ? TC : {}>,
    Merge<TStore, TPlugin extends Ipcora<any, infer TS, any, any, any, any, any, any> ? TS : {}>,
    Merge<TMacros, TPlugin extends Ipcora<any, any, infer TM, any, any, any, any, any> ? TM : {}>,
    Merge<TRoutes, TPlugin extends Ipcora<any, any, any, infer TR, any, any, any, any> ? TR : {}>,
    TPrefix,
    TErrors | (TPlugin extends Ipcora<any, any, any, any, any, infer TE, any, any> ? TE : never),
    Merge<TEvents, TPlugin extends Ipcora<any, any, any, any, any, any, infer TEV, any> ? TEV : {}>,
    Merge<THandlers, TPlugin extends Ipcora<any, any, any, any, any, any, any, infer TH> ? TH : {}>
  >;
  use(plugin: AnyIpcora): AnyIpcora {
    if (plugin.name) {
      const key = this.pluginKey(plugin);
      if (this.usedPlugins.has(key)) return this;
      this.usedPlugins.add(key);
    }

    // Merge macros (before routes so macro options resolve correctly).
    for (const [name, entry] of plugin.macros) {
      this.macros.set(name, entry);
    }

    // Merge error mappers.
    for (const [constructor, mapper] of plugin.errorMappers) {
      this.errorMappers.set(constructor, mapper);
    }

    // Capture parent's original hooks before adding the
    // plugin's contributions. We need these so we can bake them into the
    // plugin's existing routes without double-counting the plugin's own hooks
    // (which are already baked into each route definition).
    const hookKeys: (keyof HookStore<any, any>)[] = [
      'onInvoke',
      'onTransform',
      'derive',
      'resolve',
      'onGuard',
      'onBeforeHandle',
      'onAfterHandle',
      'onMapResponse',
      'onError',
      'onAfterResponse',
      'onTrace',
    ];
    const parentHooks = cloneHooks(this.hooks);

    // Merge state and decorators. Later registrations win.
    this.store = { ...this.store, ...plugin.store };
    this.decorators = { ...this.decorators, ...plugin.decorators };

    if (plugin.scope === 'scoped') {
      for (const key of hookKeys) {
        (this.hooks[key] as unknown[]).push(...(plugin.hooks[key] as unknown[]));
      }
    }

    // Merge routes. Later registrations replace earlier definitions.
    // Abstract plugins only contribute type definitions and have no runtime
    // handlers, so their routes Map is empty. They are skipped here.
    //
    // Each route's hooks were baked in at registration time on the plugin
    // (plugin globals + route locals). We merge the parent's ORIGINAL global
    // hooks (captured above) so the final
    // order is: parent → plugin → route-locals.
    for (const [path, definition] of plugin.routes) {
      const mergedHooks = cloneHooks(parentHooks);
      for (const key of hookKeys) {
        (mergedHooks[key] as unknown[]).push(...(definition.hooks[key] as unknown[]));
      }
      const merged: HandlerDefinition<any, any, any> = {
        ...definition,
        hooks: mergedHooks,
      };
      this.routes.set(path, merged);
      this.assignRouteDefinition(path, Boolean(definition.paramsSchema));
    }

    // Merge event schemas.
    for (const [name, schema] of plugin.eventSchemas) {
      this.eventSchemas.set(name, schema);
    }

    return this;
  }

  error<const TRegistry extends ErrorRegistry>(
    errors: TRegistry,
  ): Ipcora<
    TContext,
    TStore,
    TMacros,
    TRoutes,
    TPrefix,
    TErrors | ErrorRegistryPayload<TRegistry>,
    TEvents,
    THandlers
  >;
  error<const TError extends AbstractConstructor<Error>, TMapped extends IpcError>(
    errors: ReadonlyMap<TError, ErrorMapper<InstanceType<TError>, TMapped>>,
  ): Ipcora<
    TContext,
    TStore,
    TMacros,
    TRoutes,
    TPrefix,
    TErrors | ErrorMapPayload<TError, TMapped>,
    TEvents,
    THandlers
  >;
  error<const TError extends AbstractConstructor<Error>, TMapped extends IpcError>(
    error: TError,
    map: (value: { fail: typeof fail; error: InstanceType<TError> }) => TMapped,
  ): Ipcora<
    TContext,
    TStore,
    TMacros,
    TRoutes,
    TPrefix,
    TErrors | ErrorMapPayload<TError, TMapped>,
    TEvents,
    THandlers
  >;
  error(
    errorsOrError:
      | ErrorRegistry
      | AbstractConstructor<Error>
      | ReadonlyMap<AbstractConstructor<Error>, ErrorMapper>,
    map?: (value: { fail: typeof fail; error: Error }) => IpcError,
  ): AnyIpcora {
    if (errorsOrError instanceof Map) {
      for (const [constructor, mapper] of errorsOrError) {
        this.errorMappers.set(constructor, error => mapper({ fail, error }));
      }
      return this as AnyIpcora;
    }

    if (typeof errorsOrError === 'function') {
      this.errorMappers.set(
        errorsOrError,
        error => map?.({ fail, error }) ?? this.defaultError(errorsOrError, error),
      );
      return this as AnyIpcora;
    }

    for (const [name, constructor] of Object.entries(errorsOrError)) {
      this.errorMappers.set(constructor, error => this.defaultError(constructor, error, name));
    }
    return this as AnyIpcora;
  }

  handler<
    const TPath extends string,
    TParamsSchema extends AnySchema | undefined = undefined,
    TResponseSchema extends AnySchema | undefined = undefined,
    TMetadataSchema extends AnySchema | undefined = undefined,
    TParams = TParamsSchema extends AnySchema ? InferSchemaOutput<TParamsSchema> : void,
    TResponse = TResponseSchema extends AnySchema ? InferSchemaInput<TResponseSchema> : any,
    THandler extends HandlerFunction<TParams, TResponse, TContext, TStore, TEvents> =
      HandlerFunction<TParams, TResponse, TContext, TStore, TEvents>,
    TRouteResponse = TResponseSchema extends AnySchema ? TResponse : Awaited<ReturnType<THandler>>,
    TOptions extends object = {},
    TLocalErrors = TOptions extends { onError?: infer THook } ? OnErrorHookPayload<THook> : never,
  >(
    path: TPath,
    handler: THandler,
    options: HandlerOptions<
      TParamsSchema,
      TResponseSchema,
      TMetadataSchema,
      TContext,
      TStore,
      TMacros
    > &
      TOptions = {} as HandlerOptions<
      TParamsSchema,
      TResponseSchema,
      TMetadataSchema,
      TContext,
      TStore,
      TMacros
    > &
      TOptions,
  ): Ipcora<
    TContext,
    TStore,
    TMacros,
    Merge<
      TRoutes,
      PathToObject<
        JoinPathType<TPrefix, TPath>,
        RouteHandler<TParams, TRouteResponse, TErrors | TLocalErrors>
      >
    >,
    TPrefix,
    TErrors,
    TEvents,
    Merge<
      THandlers,
      PathToObject<
        JoinPathType<TPrefix, TPath>,
        RouteHandler<TParams, TRouteResponse, TErrors | TLocalErrors>
      >
    >
  > {
    const fullPath = joinPath(this.prefix, path);

    // Abstract routers only contribute type definitions, no runtime registration.
    if (this.abstract) {
      this.assignRouteDefinition(fullPath, Boolean(options.params));
      return this as unknown as Ipcora<
        TContext,
        TStore,
        TMacros,
        Merge<
          TRoutes,
          PathToObject<
            JoinPathType<TPrefix, TPath>,
            RouteHandler<TParams, TRouteResponse, TErrors | TLocalErrors>
          >
        >,
        TPrefix,
        TErrors,
        TEvents,
        Merge<
          THandlers,
          PathToObject<
            JoinPathType<TPrefix, TPath>,
            RouteHandler<TParams, TRouteResponse, TErrors | TLocalErrors>
          >
        >
      >;
    }

    const hooks = cloneHooks(this.hooks);
    const macroSchemas = this.appendMacroHooks(hooks, options);
    this.appendHandlerHooks(hooks, options);

    const paramsSchema = this.composeSchemas([...macroSchemas.params, options.params]);
    const responseSchema = this.composeSchemas([...macroSchemas.response, options.response]);
    const validateResponse =
      this.options.validateResponse !== false && options.validateResponse !== false;
    const metadataSchema = options.metadata;

    this.routes.set(fullPath, {
      path: fullPath,
      handler: handler as HandlerFunction<any, any, TContext, TStore, TEvents>,
      paramsSchema,
      responseSchema,
      validateResponse,
      metadataSchema,
      hooks,
    });
    this.assignRouteDefinition(fullPath, Boolean(paramsSchema));
    return this as unknown as Ipcora<
      TContext,
      TStore,
      TMacros,
      Merge<
        TRoutes,
        PathToObject<
          JoinPathType<TPrefix, TPath>,
          RouteHandler<TParams, TRouteResponse, TErrors | TLocalErrors>
        >
      >,
      TPrefix,
      TErrors,
      TEvents,
      Merge<
        THandlers,
        PathToObject<
          JoinPathType<TPrefix, TPath>,
          RouteHandler<TParams, TRouteResponse, TErrors | TLocalErrors>
        >
      >
    >;
  }

  events<const TEventMap extends DefinedEvents<any, any>>(
    schema: TEventMap,
  ): Ipcora<
    TContext,
    TStore,
    TMacros,
    Merge<TRoutes, DefinedEventsDefinition<TEventMap>>,
    TPrefix,
    TErrors,
    Merge<TEvents, DefinedEventsDefinition<TEventMap>>,
    THandlers
  >;
  events(schema: DefinedEvents<any, any>): AnyIpcora {
    this.registerEventSchemas(schema as unknown as Record<string, unknown>);

    return this as unknown as AnyIpcora;
  }

  async emit<const TName extends EventNames<TEvents> & string>(
    name: TName,
    payload: EventInputByName<TEvents, TName>,
    options: EventEmitOptions = {},
  ): Promise<void> {
    const schema = this.eventSchemas.get(name);
    if (!schema) {
      throw new Error(`IPC event not found: ${name}`);
    }
    if (this.options.validateEvents) {
      await parseSchema(schema, payload);
    }
    const adapter = this.options.adapter;
    if (!adapter) {
      throw new Error('IPC adapter is required. Pass an adapter to ipcora({ adapter }).');
    }

    const bindings = options.peers
      ? this.resolveEventBindings(options.peers)
      : this.bindings.values();
    const channel = this.eventChannel(name);
    await Promise.all(
      [...bindings].map(binding => adapter.emit(channel, binding.peer.sender, payload)),
    );
  }

  group<
    const TPath extends string,
    TGroupRoutes extends object,
    TGroupEvents extends object,
    TGroupHandlers extends object,
  >(
    prefix: TPath,
    configure: (
      ipc: Ipcora<
        TContext,
        TStore,
        TMacros,
        TRoutes,
        JoinPathType<TPrefix, TPath>,
        TErrors,
        TEvents,
        THandlers
      >,
    ) => Ipcora<any, any, any, TGroupRoutes, any, any, TGroupEvents, TGroupHandlers>,
  ): Ipcora<
    TContext,
    TStore,
    TMacros,
    Merge<TRoutes, TGroupRoutes>,
    TPrefix,
    TErrors,
    Merge<TEvents, TGroupEvents>,
    Merge<THandlers, TGroupHandlers>
  > {
    configure(this.createScope(joinPath(this.prefix, prefix)));
    return this as unknown as Ipcora<
      TContext,
      TStore,
      TMacros,
      Merge<TRoutes, TGroupRoutes>,
      TPrefix,
      TErrors,
      Merge<TEvents, TGroupEvents>,
      Merge<THandlers, TGroupHandlers>
    >;
  }

  /**
   * Bind a peer to this router. Only bound peers may dispatch calls.
   */
  bind(...peers: IpcPeer[]): () => void {
    this.installAdapter();
    const disposers = peers.map(peer => {
      const controller = new AbortController();
      this.bindings.set(peer.sender.id, { peer, controller });

      const dispose = () => {
        controller.abort();
        this.bindings.delete(peer.sender.id);
      };
      peer.onDispose?.(dispose);
      return dispose;
    });

    return () => {
      for (const dispose of disposers) dispose();
    };
  }

  dispose(): void {
    for (const binding of this.bindings.values()) binding.controller.abort();
    this.bindings.clear();
    if (this.installed) {
      this.options.adapter?.removeHandler(this.channel);
      if (this.name) Ipcora.installedNames.delete(this.name);
      this.installed = false;
    }
  }

  private appendMacroHooks(
    hooks: HookStore<TContext, TStore>,
    options: HandlerOptions<any, any, any, TContext, TStore, TMacros>,
  ): { params: AnySchema[]; response: AnySchema[] } {
    const schemas: { params: AnySchema[]; response: AnySchema[] } = { params: [], response: [] };
    const seen = new Set<unknown>();

    for (const [key, option] of Object.entries(options)) {
      if (builtInHandlerOptionKeys.has(key) || option === undefined) continue;
      const macro = this.macros.get(key);
      if (!macro) continue;
      this.appendMacroHookSet(hooks, macro, option, schemas, seen, 0);
    }

    return schemas;
  }

  private appendMacroHookSet(
    hooks: HookStore<TContext, TStore>,
    entry: AnyMacroEntry,
    option: unknown,
    schemas: { params: AnySchema[]; response: AnySchema[] },
    seen: Set<unknown>,
    depth: number,
  ): void {
    if (option === false) return;
    if (depth >= 16) {
      throw new Error('Macro expansion depth exceeded. Check for circular macro dependencies.');
    }

    const macro = this.resolveMacroEntry(entry, option);
    if (!macro) return;

    const seed = macro.seed ?? option;
    const dedupeKey = `${seed === undefined ? 'undefined' : JSON.stringify(seed)}:${this.findMacroName(entry) ?? ''}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    for (const [key, nestedOption] of Object.entries(macro)) {
      if (this.isMacroDefinitionKey(key) || nestedOption === undefined) continue;
      const nested = this.macros.get(key);
      if (!nested) continue;
      this.appendMacroHookSet(hooks, nested, nestedOption, schemas, seen, depth + 1);
    }

    if (macro.params) schemas.params.push(macro.params);
    if (macro.response) schemas.response.push(macro.response);

    const wrap = <THook extends (value: any) => Promisable<any>>(hook: THook) => {
      return ((value: Parameters<THook>[0]) => hook({ ...value, option })) as THook;
    };
    const asHook = <THook>(hook: unknown) => hook as THook;

    if (macro.onInvoke) {
      hooks.onInvoke.push(asHook<OnInvokeHook<TContext, TStore>>(wrap(macro.onInvoke)));
    }
    if (macro.onTransform) {
      hooks.onTransform.push(asHook<OnTransformHook<TContext, TStore>>(wrap(macro.onTransform)));
    }
    if (macro.derive) {
      hooks.derive.push(asHook<DeriveHook<TContext, TStore>>(wrap(macro.derive)));
    }
    if (macro.resolve) {
      hooks.resolve.push(asHook<ResolveHook<TContext, TStore>>(wrap(macro.resolve)));
    }
    if (macro.onGuard) {
      hooks.onGuard.push(asHook<OnGuardHook<TContext, TStore>>(wrap(macro.onGuard)));
    }
    if (macro.onBeforeHandle) {
      hooks.onBeforeHandle.push(
        asHook<OnBeforeHandleHook<TContext, TStore>>(wrap(macro.onBeforeHandle)),
      );
    }
    if (macro.onAfterHandle) {
      hooks.onAfterHandle.push(
        asHook<OnAfterHandleHook<TContext, TStore>>(wrap(macro.onAfterHandle)),
      );
    }
    if (macro.onMapResponse) {
      hooks.onMapResponse.push(
        asHook<OnMapResponseHook<TContext, TStore>>(wrap(macro.onMapResponse)),
      );
    }
    if (macro.onError) {
      hooks.onError.push(asHook<OnErrorHook<TContext, TStore>>(wrap(macro.onError)));
    }
    if (macro.onAfterResponse) {
      hooks.onAfterResponse.push(
        asHook<OnAfterResponseHook<TContext, TStore>>(wrap(macro.onAfterResponse)),
      );
    }
    if (macro.onTrace) {
      hooks.onTrace.push(asHook<OnTraceHook<TContext, TStore>>(wrap(macro.onTrace)));
    }
  }

  private resolveMacroEntry(entry: AnyMacroEntry, option: unknown): AnyMacroDefinition | void {
    if (typeof entry !== 'function') return entry;
    const definition = entry(option);
    if (definition && typeof (definition as Promise<unknown>).then === 'function') {
      throw new Error('Async macro factories are not supported during handler registration.');
    }
    return definition as AnyMacroDefinition | void;
  }

  private findMacroName(entry: AnyMacroEntry): string | undefined {
    for (const [name, macro] of this.macros) {
      if (macro === entry) return name;
    }
  }

  private isMacroDefinitionKey(key: string): boolean {
    return builtInHandlerOptionKeys.has(key) || key === 'seed';
  }

  private composeSchemas(schemas: (AnySchema | undefined)[]): AnySchema | undefined {
    const active = schemas.filter((schema): schema is AnySchema => Boolean(schema));
    if (active.length === 0) return undefined;
    if (active.length === 1) return active[0];

    return {
      '~standard': {
        version: 1,
        vendor: 'ipcora',
        validate: async value => {
          let current = value;
          for (const schema of active) {
            const result = await schema['~standard'].validate(current);
            if ('issues' in result && result.issues) return result;
            current = result.value;
          }
          return { value: current };
        },
      },
    };
  }

  private appendHandlerHooks(
    hooks: HookStore<TContext, TStore>,
    options: BuiltInHandlerOptions<any, any, any, TContext, TStore>,
  ): void {
    const append = <T>(list: T[], value: T | undefined) => {
      if (value) list.push(value);
    };

    append(hooks.onInvoke, options.onInvoke);
    append(hooks.onTransform, options.onTransform);
    append(hooks.derive, options.derive);
    append(hooks.resolve, options.resolve);
    append(hooks.onGuard, options.onGuard);
    append(hooks.onBeforeHandle, options.onBeforeHandle);
    append(hooks.onAfterHandle, options.onAfterHandle);
    append(hooks.onMapResponse, options.onMapResponse);
    append(hooks.onError, options.onError);
    append(hooks.onAfterResponse, options.onAfterResponse);
    append(hooks.onTrace, options.onTrace);
  }

  private assignRouteDefinition(path: string, hasParams: boolean): void {
    const parts = path.split('.').filter(Boolean);
    let node = this.manifest as UnknownRecord;

    for (const part of parts.slice(0, -1)) {
      const current = node[part];
      if (!current || typeof current !== 'object') {
        node[part] = {};
      }
      node = node[part] as UnknownRecord;
    }

    const method = parts.at(-1);
    if (method) {
      node[method] = hasParams
        ? function ipcoraRouteDefinition(_p: any) {}
        : function ipcoraRouteDefinition() {};
    }
  }

  private pluginKey(plugin: AnyIpcora): string {
    return `${plugin.name ?? ''}:${String(plugin.options.seed ?? '')}`;
  }

  private assignEventDefinition(name: string, channel: string, once: boolean): void {
    // Split dotted names (e.g. "user.login") into namespace path + base name
    // so that the definition tree mirrors the namespace: definition.user.onLogin.
    const nameParts = name.split('.');
    const baseName = nameParts.at(-1)!;
    const namespaceParts = nameParts.slice(0, -1);
    const key = `${once ? 'onOnce' : 'on'}${capitalize(baseName)}`;

    const definition = function ipcoraEventDefinition() {};
    Object.defineProperties(definition, {
      __ipcoraEvent: { value: true },
      name: { value: name, configurable: true },
      channel: { value: channel },
      once: { value: once },
      payload: { value: undefined },
      input: { value: undefined },
    });

    if (namespaceParts.length === 0) {
      (this.manifest as UnknownRecord)[key] = definition;
      return;
    }

    // Build nested objects for namespace parts
    let node = this.manifest as UnknownRecord;
    for (const part of namespaceParts) {
      const current = node[part];
      if (!current || typeof current !== 'object') {
        node[part] = {};
      }
      node = node[part] as UnknownRecord;
    }
    node[key] = definition;
  }

  private registerEventSchemas(schema: Record<string, unknown>, prefix?: string): void {
    for (const [name, value] of Object.entries(schema)) {
      const fullName = prefix ? `${prefix}.${name}` : name;

      if (isSchema(value)) {
        const channel = this.eventChannel(fullName);
        this.eventSchemas.set(fullName, value);
        this.assignEventDefinition(fullName, channel, false);
        this.assignEventDefinition(fullName, channel, true);
        continue;
      }

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.registerEventSchemas(value as Record<string, unknown>, fullName);
      }
    }
  }

  private eventChannel(name: string): string {
    return `${this.channel}:event:${name}`;
  }

  private resolveEventBindings(peers: Iterable<IpcPeer | number>): Binding[] {
    const bindings: Binding[] = [];
    for (const peer of peers) {
      const id = typeof peer === 'number' ? peer : peer.sender.id;
      const binding = this.bindings.get(id);
      if (binding) bindings.push(binding);
    }
    return bindings;
  }

  private installAdapter(): void {
    if (this.abstract) return;
    if (this.installed) return;

    if (this.name && Ipcora.installedNames.has(this.name)) {
      throw new Error(
        `IPC router "${this.name}" is already installed. Each named router can only be bound once.`,
      );
    }

    const { adapter } = this.options;
    if (!adapter) {
      throw new Error('IPC adapter is required. Pass an adapter to ipcora({ adapter }).');
    }
    if (adapter.listenerCount(this.channel) > 0) {
      throw new Error(`IPC channel already registered: ${this.channel}`);
    }
    adapter.handle(this.channel, (event, invoke) => this.dispatch(event, invoke));
    if (this.name) Ipcora.installedNames.add(this.name);
    this.installed = true;
  }

  private async dispatch(event: IpcEvent, invoke: IpcInvoke): Promise<IpcResponse> {
    const binding = this.bindings.get(event.sender.id);
    if (!binding) {
      return this.errorResponse(fail('PEER_NOT_BOUND'));
    }
    const definition = this.routes.get(invoke.path);
    if (!definition) {
      return this.errorResponse(
        fail('HANDLER_NOT_FOUND', {
          message: `IPC handler not found: ${invoke.path}`,
        }),
      );
    }

    const startedAt = performance.now();
    let metadata: Readonly<Record<string, unknown>> = Object.freeze({ ...invoke.metadata });
    let phase: LifecyclePhase = 'onInvoke';
    const spans: IpcTraceSpan[] = [];
    let params: unknown = invoke.params;
    let handlerResponse: unknown;
    let response: IpcResponse | undefined;
    let caught: unknown;
    let context: RuntimeContext<TContext, TStore, TEvents> = {
      ...this.decorators,
      store: this.store as TStore,
      peer: binding.peer,
      sender: event.sender,
      event,
      emit: this.emit.bind(this) as RuntimeContext<TContext, TStore, TEvents>['emit'],
      $emit: this.$emit,
    } as RuntimeContext<TContext, TStore, TEvents>;

    const base = () => ({
      ...context,
      id: invoke.id,
      path: definition.path,
      event,
      signal: binding.controller.signal,
      startedAt,
      metadata,
      fail,
    });

    const runSpan = async <T>(nextPhase: IpcTracePhase, run: () => Promise<T>): Promise<T> => {
      phase = nextPhase;
      const spanStartedAt = performance.now();
      try {
        return await run();
      } finally {
        spans.push({ phase: nextPhase, duration: performance.now() - spanStartedAt });
      }
    };

    try {
      await runSpan('onInvoke', async () => {
        for (const hook of definition.hooks.onInvoke) {
          await hook({ ...base(), invoke, rawParams: invoke.params });
        }
      });

      // Transform and derive run before validation so they can normalize raw params
      // and add request-derived context before schemas are evaluated.
      await runSpan('onTransform', async () => {
        for (const hook of definition.hooks.onTransform) {
          const next = await hook({ ...base(), params });
          if (next !== undefined) params = next;
        }
      });

      await runSpan('derive', async () => {
        for (const hook of definition.hooks.derive) {
          const extension = await hook({ ...base(), params, rawParams: invoke.params });
          if (extension) {
            context = { ...context, ...extension };
          }
        }
      });

      // onGuard runs before validation so it can short-circuit early
      // without paying schema validation cost. Guards receive raw params.
      await runSpan('onGuard', async () => {
        for (const hook of definition.hooks.onGuard) {
          const extension = await hook({ ...base(), params });
          if (extension) {
            context = { ...context, ...extension };
          }
        }
      });

      await runSpan('validation', async () => {
        const validatedMeta = await parseSchema(definition.metadataSchema, metadata);
        metadata = Object.freeze({ ...(validatedMeta as Record<string, unknown>) });
        params = await parseSchema(definition.paramsSchema, params);
      });

      await runSpan('resolve', async () => {
        for (const hook of definition.hooks.resolve) {
          const extension = await hook({ ...base(), params, rawParams: invoke.params });
          if (extension) {
            context = { ...context, ...extension };
          }
        }
      });

      await runSpan('onBeforeHandle', async () => {
        for (const hook of definition.hooks.onBeforeHandle) {
          await hook({ ...base(), params });
        }
      });

      handlerResponse = await runSpan('handler', () =>
        Promise.resolve(definition.handler({ ...base(), ...context, params })),
      );
      if (handlerResponse instanceof IpcError) {
        throw handlerResponse;
      }

      await runSpan('onAfterHandle', async () => {
        for (const hook of [...definition.hooks.onAfterHandle].reverse()) {
          const next = await hook({ ...base(), params, response: handlerResponse });
          if (next !== undefined) handlerResponse = next;
        }
      });

      if (handlerResponse instanceof IpcError) {
        throw handlerResponse;
      }

      await runSpan('validation', async () => {
        if (definition.validateResponse) {
          await parseSchema(definition.responseSchema, handlerResponse);
        }
        response = { data: handlerResponse };
      });

      await runSpan('onMapResponse', async () => {
        for (const hook of [...definition.hooks.onMapResponse].reverse()) {
          const next = await hook({ ...base(), params, handlerResponse, response: response! });
          if (next !== undefined) response = next;
        }
      });
    } catch (error) {
      caught = error;
      const failedPhase = phase;
      const normalized = this.normalizeError(error);
      await runSpan('onError', async () => {
        for (const hook of [...definition.hooks.onError].reverse()) {
          const handled = await hook({
            ...base(),
            params,
            rawParams: invoke.params,
            cause: error,
            name: normalized.name,
            error: normalized,
            phase: failedPhase,
          });
          if (handled !== undefined) {
            response = handled instanceof IpcError ? this.errorResponse(handled) : handled;
            break;
          }
        }
      });
      response ??= this.errorResponse(error);
    }

    let duration = performance.now() - startedAt;
    await runSpan('onAfterResponse', async () => {
      for (const hook of [...definition.hooks.onAfterResponse].reverse()) {
        try {
          await hook({
            ...base(),
            params,
            handlerResponse,
            response: response!,
            cause: caught,
            phase,
            success: !response!.error,
            duration,
          });
        } catch (error) {
          this.options.onAfterResponseError?.(error, definition.path);
        }
      }
    });

    duration = performance.now() - startedAt;
    phase = 'onTrace';
    const endedAt = startedAt + duration;
    for (const hook of definition.hooks.onTrace) {
      try {
        await hook({
          ...base(),
          params,
          handlerResponse,
          response: response!,
          cause: caught,
          success: !response!.error,
          duration,
          endedAt,
          spans,
        });
      } catch (error) {
        this.options.onAfterResponseError?.(error, definition.path);
      }
    }

    return response!;
  }

  private errorResponse(error: unknown): IpcResponse {
    const mapped = this.normalizeError(error);
    return {
      error: {
        name: mapped.name,
        message: mapped.message,
        data: mapped.data,
        ...(this.options.exposeStack ? { stack: mapped.stack } : {}),
      },
    };
  }

  private normalizeError(error: unknown): IpcError {
    if (error instanceof IpcError) return error;

    if (error instanceof Error) {
      for (const [constructor, mapper] of this.errorMappers) {
        if (error instanceof constructor) return mapper(error);
      }

      return fail(error.name, {
        message: error.message,
        cause: error,
      });
    }

    const normalized = new Error(String(error));
    return fail('INTERNAL_SERVER_ERROR', {
      message: 'Internal IPC error',
      cause: normalized,
    });
  }

  private defaultError(
    constructor: AbstractConstructor<Error>,
    error: Error,
    name = constructor.name,
  ): IpcError {
    return fail(name, {
      message: error.message,
      cause: error,
    });
  }
}

export type AnyIpcora = Ipcora<any, any, any, any, any, any, any, any>;

export function ipcora<TContext extends object = {}, TStore extends object = {}>(
  options?: IpcoraOptions,
): Ipcora<TContext, TStore> {
  return new Ipcora<TContext, TStore>(options);
}

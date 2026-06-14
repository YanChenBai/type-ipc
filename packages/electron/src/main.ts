import { BaseWindow, BrowserWindow, ipcMain } from 'electron';
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { Ipcora as IpcoraBase } from 'ipcora';
import type {
  AnyIpcora,
  AnySchema,
  DefinedEvents,
  DefinedEventsDefinition,
  EventEmitter,
  EventNames,
  EventPayloadByName,
  HandlerFunction,
  HandlerOptions,
  InferSchemaInput,
  InferSchemaOutput,
  IpcAdapter,
  IpcEvent,
  Ipcora,
  IpcoraOptions,
  IpcPeer,
  IpcInvoke,
  JoinPathType,
  MacroDefinition,
  MacroRegistry,
  Merge,
  OnErrorHookPayload,
  PathToObject,
  RouteHandler,
} from 'ipcora';

import { ELECTRON_IPCORA_CHANNEL } from './constants';

export { ELECTRON_IPCORA_CHANNEL } from './constants';

export type ElectronIpcEvent = IpcMainInvokeEvent & IpcEvent<WebContents>;

export type ElectronIpcMain = Pick<IpcMain, 'handle' | 'listenerCount' | 'removeHandler'>;

export type ElectronIpcAdapter = IpcAdapter<ElectronIpcEvent>;

export type ElectronIpcoraOptions = Omit<IpcoraOptions, 'adapter' | 'channel'>;

export type ElectronIpcPeer = IpcPeer<WebContents> & {
  window: BaseWindow;
};

export type ElectronBrowserWindowMacro = MacroDefinition<any, any, boolean | undefined> & {
  resolve: (value: { sender: unknown; peer: IpcPeer; option: boolean | undefined }) => {
    browserWindow: BrowserWindow;
  };
};

export type ElectronBaseWindowMacro = MacroDefinition<any, any, boolean | undefined> & {
  resolve: (value: { peer: IpcPeer; option: boolean | undefined }) => {
    baseWindow: BaseWindow;
  };
};

type Expand<T> = { [K in keyof T]: T[K] } & {};

type ElectronMacroRegistry = {
  browserWindow: ElectronBrowserWindowMacro;
  baseWindow: ElectronBaseWindowMacro;
};

type ElectronHandlerContext<TContext extends object, TOptions extends object> = Expand<
  TContext &
    ('browserWindow' extends keyof TOptions ? { browserWindow: BrowserWindow } : {}) &
    ('baseWindow' extends keyof TOptions ? { baseWindow: BaseWindow } : {})
>;

type RoutesOf<TIpcora> =
  TIpcora extends ElectronIpcora<any, any, any, infer TRoutes, any, any, any, any> ? TRoutes : {};

type EventsOf<TIpcora> =
  TIpcora extends ElectronIpcora<any, any, any, any, any, any, infer TEvents, any> ? TEvents : {};

type HandlersOf<TIpcora> =
  TIpcora extends ElectronIpcora<any, any, any, any, any, any, any, infer THandlers>
    ? THandlers
    : {};

type EventsOfBindable<TIpcora> =
  TIpcora extends ElectronIpcora<any, any, any, any, any, any, infer TEvents, any>
    ? TEvents
    : TIpcora extends Ipcora<any, any, any, any, any, any, infer TEvents, any>
      ? TEvents
      : {};

interface BindableIpcora {
  bind(...peers: IpcPeer[]): () => void;
  emit(
    name: string,
    payload: unknown,
    options?: { peers?: Iterable<IpcPeer | number> },
  ): Promise<void>;
}

export interface BoundBrowserWindow<TEvents extends object = {}> {
  id: number;
  window: BaseWindow;
  unbind: () => void;
  emit: <const TName extends EventNames<TEvents> & string>(
    name: TName,
    payload: EventPayloadByName<TEvents, TName>,
  ) => Promise<void>;
  $emit: EventEmitter<TEvents>;
}

export type ElectronIpcora<
  TContext extends object = {},
  TStore extends object = {},
  TMacros extends MacroRegistry = ElectronMacroRegistry,
  TRoutes extends object = {},
  TPrefix extends string = '',
  TErrors = never,
  TEvents extends object = {},
  THandlers extends object = {},
> = Omit<
  Ipcora<TContext, TStore, TMacros, TRoutes, TPrefix, TErrors, TEvents, THandlers>,
  'handler' | 'group' | 'events'
> & {
  handler<
    const TPath extends string,
    TParamsSchema extends AnySchema | undefined = undefined,
    TResponseSchema extends AnySchema | undefined = undefined,
    TMetadataSchema extends AnySchema | undefined = undefined,
    TOptions extends object = {},
    TRouteContext extends object = ElectronHandlerContext<TContext, TOptions>,
    TParams = TParamsSchema extends AnySchema ? InferSchemaOutput<TParamsSchema> : void,
    TResponse = TResponseSchema extends AnySchema ? InferSchemaInput<TResponseSchema> : any,
    THandler extends HandlerFunction<TParams, TResponse, TRouteContext, TStore, TEvents> =
      HandlerFunction<TParams, TResponse, TRouteContext, TStore, TEvents>,
    TRouteResponse = TResponseSchema extends AnySchema ? TResponse : Awaited<ReturnType<THandler>>,
    TLocalErrors = TOptions extends { onError?: infer THook } ? OnErrorHookPayload<THook> : never,
  >(
    path: TPath,
    handler: THandler,
    options?: HandlerOptions<
      TParamsSchema,
      TResponseSchema,
      TMetadataSchema,
      TRouteContext,
      TStore,
      TMacros
    > &
      TOptions,
  ): ElectronIpcora<
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
  group<const TPath extends string, TGroupIpcora>(
    prefix: TPath,
    configure: (
      ipc: ElectronIpcora<
        TContext,
        TStore,
        TMacros,
        TRoutes,
        JoinPathType<TPrefix, TPath>,
        TErrors,
        TEvents,
        THandlers
      >,
    ) => TGroupIpcora,
  ): ElectronIpcora<
    TContext,
    TStore,
    TMacros,
    Merge<TRoutes, RoutesOf<TGroupIpcora>>,
    TPrefix,
    TErrors,
    Merge<TEvents, EventsOf<TGroupIpcora>>,
    Merge<THandlers, HandlersOf<TGroupIpcora>>
  >;
  events<const TEventMap extends DefinedEvents<any, any>>(
    schema: TEventMap,
  ): ElectronIpcora<
    TContext,
    TStore,
    TMacros,
    Merge<TRoutes, DefinedEventsDefinition<TEventMap>>,
    TPrefix,
    TErrors,
    Merge<TEvents, DefinedEventsDefinition<TEventMap>>,
    THandlers
  >;
};

export function electronIpcAdapter(): ElectronIpcAdapter {
  return {
    handle(channel, handler) {
      ipcMain.handle(channel, (event, invoke) => {
        return handler(event as ElectronIpcEvent, invoke as IpcInvoke);
      });
    },
    emit(channel, sender, payload) {
      sender.send(channel, payload);
    },
    listenerCount(channel) {
      return ipcMain.listenerCount(channel);
    },
    removeHandler(channel) {
      ipcMain.removeHandler(channel);
    },
  };
}

export function electronIpcora<TContext extends object = {}, TStore extends object = {}>(
  options: ElectronIpcoraOptions = {},
): ElectronIpcora<TContext, TStore> {
  return new IpcoraBase<TContext, TStore>({
    ...options,
    channel: ELECTRON_IPCORA_CHANNEL,
    adapter: electronIpcAdapter(),
  })
    .macro('browserWindow', {
      resolve: ({ sender, peer }) => ({
        browserWindow:
          BrowserWindow.fromWebContents(sender as unknown as WebContents) ??
          ((peer as unknown as ElectronIpcPeer).window as BrowserWindow),
      }),
    } satisfies ElectronBrowserWindowMacro)
    .macro('baseWindow', {
      resolve: ({ peer }) => ({
        baseWindow: (peer as unknown as ElectronIpcPeer).window,
      }),
    } satisfies ElectronBaseWindowMacro) as ElectronIpcora<TContext, TStore>;
}

export function electronBrowserWindowPeer(window: BaseWindow): ElectronIpcPeer {
  return {
    sender: (window as BrowserWindow).webContents,
    window,
    onDispose(dispose) {
      window.once('closed', dispose);
    },
  };
}

export function bindWindow<TIpcora>(
  ipcora: TIpcora,
  window: BaseWindow,
): BoundBrowserWindow<EventsOfBindable<TIpcora>> {
  const peer = electronBrowserWindowPeer(window);
  const bindable = ipcora as unknown as BindableIpcora;
  const unbind = bindable.bind(peer);

  return {
    id: peer.sender.id,
    window,
    unbind,
    emit(name, payload) {
      return bindable.emit(name as never, payload as never, { peers: [peer.sender.id] });
    },
    $emit: createBoundEventEmitter(ipcora as unknown as AnyIpcora, peer.sender.id) as EventEmitter<
      EventsOfBindable<TIpcora>
    >,
  };
}

function createBoundEventEmitter(ipcora: AnyIpcora, peerId: number, path = ''): EventEmitter<any> {
  const emit = (payload: unknown) => ipcora.emit(path, payload, { peers: [peerId] });

  return new Proxy(emit, {
    get(_target, property) {
      if (property === 'then') return undefined;
      if (property === Symbol.toStringTag) return 'IpcoraBoundEventEmitter';
      if (typeof property !== 'string' || property.includes('.')) return undefined;

      return createBoundEventEmitter(ipcora, peerId, path ? `${path}.${property}` : property);
    },
  }) as EventEmitter<any>;
}

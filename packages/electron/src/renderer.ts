import type { DefinedEvents, DefinedEventsDefinition } from 'ipcora';
import {
  ipcoraClient,
  type Client,
  type ClientHooks,
  type IpcoraClientOptions,
} from 'ipcora/client';
import type { InferDefinition } from 'ipcora/client';

import { ELECTRON_IPCORA_CHANNEL } from './constants';
import type { IpcoraBridge } from './preload';

export type { Client, ClientHooks, IpcoraClientOptions, InferDefinition };

type AnyFunction = (...args: any[]) => any;
type Expand<T> = { [K in keyof T]: T[K] } & {};
type ClientMetadata = Record<string, unknown>;
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
type ThrowInvokeClient<T> = T extends AnyFunction
  ? Parameters<T> extends []
    ? () => Promise<DataOf<ReturnType<T>>>
    : (...args: [...Parameters<T>, metadata?: ClientMetadata]) => Promise<DataOf<ReturnType<T>>>
  : T extends object
    ? { [K in keyof T]: ThrowInvokeClient<T[K]> }
    : never;
type IpcoraClient<
  TDefinition extends { handlers: object; events: object },
  TThrowInvokeError extends boolean,
> = TThrowInvokeError extends true
  ? {
      invoke: Expand<ThrowInvokeClient<TDefinition['handlers']>>;
      event: Client<TDefinition>['event'];
    }
  : Client<TDefinition>;

/**
 * Options for {@link electronIpcoraClient}.
 */
export type ElectronIpcoraClientOptions<
  TEvents extends DefinedEvents<any, any> | undefined = undefined,
  TThrowInvokeError extends boolean = boolean,
> = {
  metadata?: Record<string, unknown>;
  hooks?: ClientHooks;
  eventSchema?: TEvents;
  throwInvokeError?: TThrowInvokeError;
};

type ClientDefinitionFromEvents<TEvents> = {
  handlers: {};
  events: TEvents extends DefinedEvents<any, any> ? DefinedEventsDefinition<TEvents> : {};
};

function getBridge(): IpcoraBridge {
  const bridge = (window as unknown as Window).__IPCORA__;
  if (!bridge) {
    throw new Error(
      'Ipcora bridge not found at window.__IPCORA__. ' +
        'Ensure exposeIpcoraBridge() was called in your preload script.',
    );
  }
  return bridge;
}

/**
 * Create a typed IPC client backed by the preload bridge.
 *
 * @param options — Optional static metadata and metadata hook.
 *
 * @example
 * ```ts
 * // renderer.ts
 * import { electronIpcoraClient, type InferDefinition } from "@ipcora/electron/renderer";
 * import type { appIpcora } from "../main/ipc"; // import type only — no runtime dependency
 *
 * const client = electronIpcoraClient<InferDefinition<typeof appIpcora>>();
 *
 * const user = await client.invoke.user.get({ id: "1" });
 * //    ^ typed as { data: { id: string; name: string } | null; error: ... }
 * ```
 */
export function electronIpcoraClient<
  const TEvents extends DefinedEvents<any, any>,
  const TThrowInvokeError extends boolean = false,
>(
  options: ElectronIpcoraClientOptions<TEvents, TThrowInvokeError>,
): IpcoraClient<ClientDefinitionFromEvents<TEvents>, TThrowInvokeError>;
export function electronIpcoraClient<
  TDefinition extends { handlers: object; events: object } = { handlers: {}; events: {} },
>(
  options: ElectronIpcoraClientOptions<any, true> & { throwInvokeError: true },
): IpcoraClient<TDefinition, true>;
export function electronIpcoraClient<
  TDefinition extends { handlers: object; events: object } = { handlers: {}; events: {} },
  const TThrowInvokeError extends boolean = false,
>(
  options?: ElectronIpcoraClientOptions<any, TThrowInvokeError>,
): IpcoraClient<TDefinition, TThrowInvokeError>;
export function electronIpcoraClient<
  TDefinition extends { handlers: object; events: object } = { handlers: {}; events: {} },
>(
  options: ElectronIpcoraClientOptions<any, boolean> & { throwInvokeError?: boolean },
): IpcoraClient<TDefinition, boolean>;
export function electronIpcoraClient(options?: ElectronIpcoraClientOptions<any>): Client<any> {
  const bridge = getBridge();

  return ipcoraClient<any, boolean>({
    adapter: {
      invoke(call) {
        return bridge.invoke({
          id: `${call.channel}-${Date.now()}`,
          path: call.channel,
          params: call.args.length > 0 ? call.args[0] : undefined,
          metadata: call.metadata,
        });
      },
      subscribe(call) {
        return bridge.subscribe(call.channel, call.listener);
      },
    },
    channel: ELECTRON_IPCORA_CHANNEL,
    metadata: options?.metadata,
    hooks: options?.hooks,
    eventSchema: options?.eventSchema,
    throwInvokeError: options?.throwInvokeError,
  } as IpcoraClientOptions<any, boolean> & { throwInvokeError?: boolean });
}

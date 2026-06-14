import type { AbstractConstructor, Simplify, UnionToIntersection } from 'type-fest';

export type { JoinPathType, Merge, PathToObject } from '../type-system';
import type { IpcError } from './errors';
import type {
  AnyMacroEntry,
  AnyMacroFactory,
  AnySchema,
  BuiltInErrorPayload,
  BuiltInHandlerOptions,
  ErrorRegistry,
  IpcErrorPayload,
  IpcResponse,
  IpcResult,
  MacroDefinition,
  MacroFactory,
} from './types';

export type { AbstractConstructor, Simplify, UnionToIntersection };

/**
 * Error payload inference.
 */

export type ErrorMapPayload<TError extends AbstractConstructor<Error>, TMapped> =
  TMapped extends IpcError<infer TName, infer TData>
    ? IpcErrorPayload<TName, TData>
    : TMapped extends IpcErrorPayload<infer TName, infer TData>
      ? IpcErrorPayload<TName, TData>
      : IpcErrorPayload<InstanceType<TError>['name'], undefined>;

export type ErrorRegistryPayload<TRegistry extends ErrorRegistry> = {
  [K in keyof TRegistry]: IpcErrorPayload<K & string, undefined>;
}[keyof TRegistry];

export type ErrorReturnPayload<TReturn> =
  Exclude<Awaited<TReturn>, void | undefined> extends infer TValue
    ? TValue extends IpcError<infer TName, infer TData>
      ? IpcErrorPayload<TName, TData>
      : TValue extends IpcResponse
        ? TValue extends { error: infer TError }
          ? TError
          : never
        : never
    : never;

export type OnErrorHookPayload<THook> = THook extends (...args: any[]) => infer TReturn
  ? ErrorReturnPayload<TReturn>
  : never;

/**
 * Lifecycle and macro extension inference.
 */

/**
 * Pull object extensions returned by derive/resolve/guard hooks into the
 * accumulated runtime context type.
 */
export type HookReturnExtension<TReturn> = [TReturn] extends [never]
  ? {}
  : Exclude<Awaited<TReturn>, void | undefined> extends infer TExtension
    ? [TExtension] extends [never]
      ? {}
      : TExtension extends object
        ? TExtension
        : {}
    : {};

type MacroOption<TMacro> =
  TMacro extends MacroDefinition<any, any, infer TOption, any>
    ? TOption
    : TMacro extends (option: infer TOption) => any
      ? TOption
      : never;

export type MacroOptions<TMacros extends Record<string, AnyMacroEntry>> = {
  [K in keyof TMacros]?: MacroOption<TMacros[K]>;
};

type MacroHookExtension<TMacroHook> = [NonNullable<TMacroHook>] extends [
  (...args: any[]) => infer TReturn,
]
  ? HookReturnExtension<TReturn>
  : {};

export type MacroDefinitionExtension<TDefinition> = TDefinition extends (
  ...args: any[]
) => infer TReturn
  ? MacroDefinitionExtension<Exclude<Awaited<TReturn>, void | undefined>>
  : Simplify<
      MacroHookExtension<TDefinition extends { derive?: infer THook } ? THook : never> &
        MacroHookExtension<TDefinition extends { resolve?: infer THook } ? THook : never> &
        MacroHookExtension<TDefinition extends { onGuard?: infer THook } ? THook : never>
    >;

type MacroHookOption<TMacroHook> = [NonNullable<TMacroHook>] extends [(value: infer TValue) => any]
  ? TValue extends { option: infer TOption }
    ? TOption
    : never
  : never;

export type MacroDefinitionOption<TDefinition> =
  | MacroHookOption<TDefinition extends { onInvoke?: infer THook } ? THook : never>
  | MacroHookOption<TDefinition extends { onTransform?: infer THook } ? THook : never>
  | MacroHookOption<TDefinition extends { derive?: infer THook } ? THook : never>
  | MacroHookOption<TDefinition extends { resolve?: infer THook } ? THook : never>
  | MacroHookOption<TDefinition extends { onGuard?: infer THook } ? THook : never>
  | MacroHookOption<TDefinition extends { onBeforeHandle?: infer THook } ? THook : never>
  | MacroHookOption<TDefinition extends { onAfterHandle?: infer THook } ? THook : never>
  | MacroHookOption<TDefinition extends { onMapResponse?: infer THook } ? THook : never>
  | MacroHookOption<TDefinition extends { onError?: infer THook } ? THook : never>
  | MacroHookOption<TDefinition extends { onAfterResponse?: infer THook } ? THook : never>
  | MacroHookOption<TDefinition extends { onTrace?: infer THook } ? THook : never>;

export type NormalizeMacroOption<TOption> = [TOption] extends [never] ? unknown : TOption;

export type MacroObjectRegistry<
  TContext extends object,
  TStore extends object,
  TDefinitions extends Record<string, AnyMacroEntry>,
> = {
  [K in keyof TDefinitions]: TDefinitions[K] extends AnyMacroFactory
    ? MacroFactory<
        TContext,
        TStore,
        MacroOption<TDefinitions[K]>,
        Exclude<Awaited<ReturnType<TDefinitions[K]>>, void | undefined> extends infer TDefinition
          ? TDefinition extends MacroDefinition<TContext, TStore, MacroOption<TDefinitions[K]>, any>
            ? TDefinition
            : void
          : void
      >
    : TDefinitions[K] extends MacroDefinition<TContext, TStore, any, any>
      ? MacroDefinition<
          TContext,
          TStore,
          NormalizeMacroOption<MacroDefinitionOption<TDefinitions[K]>>,
          MacroDefinitionExtension<TDefinitions[K]>
        >
      : never;
};

export type MacroObjectExtension<TDefinitions extends Record<string, AnyMacroEntry>> = Simplify<
  UnionToIntersection<
    {
      [K in keyof TDefinitions]: MacroDefinitionExtension<TDefinitions[K]>;
    }[keyof TDefinitions]
  >
>;

/**
 * Handler shape inference.
 */

export type RouteHandler<TParams, TResponse, TError = never> = TParams extends void
  ? () => Promise<IpcResult<Awaited<TResponse>, BuiltInErrorPayload | TError>>
  : (params: TParams) => Promise<IpcResult<Awaited<TResponse>, BuiltInErrorPayload | TError>>;

export type HandlerOptions<
  TParamsSchema extends AnySchema | undefined = undefined,
  TResponseSchema extends AnySchema | undefined = undefined,
  TMetadataSchema extends AnySchema | undefined = undefined,
  TContext extends object = object,
  TStore extends object = object,
  TMacros extends Record<string, AnyMacroEntry> = {},
> = BuiltInHandlerOptions<TParamsSchema, TResponseSchema, TMetadataSchema, TContext, TStore> &
  MacroOptions<TMacros>;

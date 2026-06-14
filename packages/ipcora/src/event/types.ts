import type { IsAny, Simplify } from 'type-fest';

import type {
  AnySchema,
  DefinedEvents,
  EventDefinition,
  EventEmitOptions,
  EventSchema,
  StandardSchemaV1,
} from '../host/types';
import type { JoinPathType, Merge } from '../type-system';

export type { DefinedEvents, EventDefinition, EventEmitOptions, EventSchema } from '../host/types';
export type { Merge } from '../type-system';
export type { IsAny, Simplify };

/**
 * Schema and event-contract inference.
 */

export type InferSchemaInput<TSchema> =
  TSchema extends StandardSchemaV1<infer T, any> ? T : unknown;

export type InferSchemaOutput<TSchema> =
  TSchema extends StandardSchemaV1<any, infer T> ? T : unknown;

export type EventSchemaInput<TEvents extends Record<string, unknown>> = {
  [K in keyof TEvents]: TEvents[K] extends AnySchema ? TEvents[K] : never;
};

export type EventSchemaTreeInput<TEvents extends Record<string, unknown>> = {
  [K in keyof TEvents]: TEvents[K] extends AnySchema
    ? TEvents[K]
    : TEvents[K] extends Record<string, unknown>
      ? EventSchemaTreeInput<TEvents[K]>
      : never;
};

export type EventPayload<TSchema> = InferSchemaOutput<TSchema>;

export type EventInput<TSchema> = InferSchemaInput<TSchema>;

export type EventDefinitions<TEvents extends EventSchema> = Simplify<
  {
    [K in keyof TEvents & string as `on${Capitalize<K>}`]: EventDefinition<
      K,
      EventInput<TEvents[K]>,
      EventPayload<TEvents[K]>
    >;
  } & {
    [K in keyof TEvents & string as `onOnce${Capitalize<K>}`]: EventDefinition<
      K,
      EventInput<TEvents[K]>,
      EventPayload<TEvents[K]>
    >;
  }
>;

/**
 * Like {@link EventDefinitions} but prepends a dot-separated path prefix to
 * each event name. Used by the `events(path, schema)` overload so that the
 * definition tree mirrors the namespace path and the stored event name
 * includes the prefix (e.g. `"user.login"` instead of `"login"`).
 */
export type PrefixedEventDefinitions<TPath extends string, TEvents extends EventSchema> = Simplify<
  {
    [K in keyof TEvents & string as `on${Capitalize<K>}`]: EventDefinition<
      `${TPath}.${K}`,
      EventInput<TEvents[K]>,
      EventPayload<TEvents[K]>
    >;
  } & {
    [K in keyof TEvents & string as `onOnce${Capitalize<K>}`]: EventDefinition<
      `${TPath}.${K}`,
      EventInput<TEvents[K]>,
      EventPayload<TEvents[K]>
    >;
  }
>;

/**
 * Convert a tree-shaped event schema into the client-facing event method tree.
 */
export type EventTreeDefinitions<
  TEvents extends Record<string, unknown>,
  TPrefix extends string = '',
  TDepth extends readonly unknown[] = [],
> = TDepth['length'] extends 8
  ? {}
  : Simplify<
      {
        [K in keyof TEvents & string as TEvents[K] extends AnySchema
          ? `on${Capitalize<K>}`
          : K]: TEvents[K] extends AnySchema
          ? EventDefinition<
              JoinPathType<TPrefix, K>,
              EventInput<TEvents[K]>,
              EventPayload<TEvents[K]>
            >
          : TEvents[K] extends Record<string, unknown>
            ? EventTreeDefinitions<TEvents[K], JoinPathType<TPrefix, K>, [...TDepth, unknown]>
            : never;
      } & {
        [K in keyof TEvents & string as TEvents[K] extends AnySchema
          ? `onOnce${Capitalize<K>}`
          : never]: TEvents[K] extends AnySchema
          ? EventDefinition<
              JoinPathType<TPrefix, K>,
              EventInput<TEvents[K]>,
              EventPayload<TEvents[K]>
            >
          : never;
      }
    >;

export type DefinedEventsSchema<TEvents> =
  TEvents extends DefinedEvents<any, any> ? TEvents['~definition']['schema'] : never;

export type DefinedEventsDefinition<TEvents> =
  TEvents extends DefinedEvents<any, any> ? TEvents['~definition']['events'] : never;

export type MergeDefinedEventSchemas<TExtends extends readonly DefinedEvents<any, any>[]> =
  TExtends extends readonly [
    infer THead extends DefinedEvents<any, any>,
    ...infer TTail extends readonly DefinedEvents<any, any>[],
  ]
    ? Merge<DefinedEventsSchema<THead>, MergeDefinedEventSchemas<TTail>>
    : {};

export type EventNames<TDefinition> = TDefinition extends object
  ? {
      [K in keyof TDefinition]: TDefinition[K] extends EventDefinition<infer TName, any>
        ? TName
        : TDefinition[K] extends object
          ? EventNames<TDefinition[K]>
          : never;
    }[keyof TDefinition]
  : never;

export type EventPayloadByName<TDefinition, TName extends string> = TDefinition extends object
  ? {
      [K in keyof TDefinition]: TDefinition[K] extends EventDefinition<TName, any, infer TPayload>
        ? TPayload
        : TDefinition[K] extends object
          ? EventPayloadByName<TDefinition[K], TName>
          : never;
    }[keyof TDefinition]
  : never;

export type EventInputByName<TDefinition, TName extends string> = TDefinition extends object
  ? {
      [K in keyof TDefinition]: TDefinition[K] extends EventDefinition<TName, infer TInput, any>
        ? TInput
        : TDefinition[K] extends object
          ? EventInputByName<TDefinition[K], TName>
          : never;
    }[keyof TDefinition]
  : never;

type EventEmitterMethod<TPayload> = (
  payload: TPayload,
  options?: EventEmitOptions,
) => Promise<void>;

type EventEmitterDefinitionKey<TKey extends string> = TKey extends `onOnce${infer TName}`
  ? Uncapitalize<TName>
  : TKey extends `on${infer TName}`
    ? Uncapitalize<TName>
    : never;

type EventEmitterTree<TDefinition> = TDefinition extends object
  ? {
      [K in keyof TDefinition & string as TDefinition[K] extends EventDefinition
        ? EventEmitterDefinitionKey<K>
        : K]: TDefinition[K] extends EventDefinition<any, infer TInput, any>
        ? EventEmitterMethod<TInput>
        : TDefinition[K] extends object
          ? EventEmitterTree<TDefinition[K]>
          : never;
    }
  : {};

export type EventEmitter<TDefinition> =
  IsAny<TDefinition> extends true ? Record<string, any> : EventEmitterTree<TDefinition>;

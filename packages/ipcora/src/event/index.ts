import type { DefinedEvents, EventTreeDefinitions, Merge, MergeDefinedEventSchemas } from './types';

export type {
  EventDefinitions,
  EventEmitter,
  EventNames,
  EventInput,
  EventInputByName,
  EventPayload,
  EventPayloadByName,
  EventSchemaInput,
  EventSchemaTreeInput,
  MergeDefinedEventSchemas,
} from './types';
export type { DefinedEvents, EventDefinition, EventEmitOptions, EventSchema } from './types';

export interface DefineEventsOptions<
  TExtends extends readonly DefinedEvents<any, any>[],
  TSchema extends Record<string, unknown>,
> {
  extends?: TExtends;
  schema: TSchema;
}

/**
 * Define a tree-shaped event contract. Leaf values are Standard Schema
 * objects, while object branches become dot-separated event namespaces.
 *
 * @example
 * ```ts
 * const events = defineEvents({
 *   window: {
 *     resized: type({ width: 'number', height: 'number' }),
 *   },
 * })
 * // event name: "window.resized"
 * // client method: client.event.window.onResized(...)
 * // emitter: ipc.$emit.window.resized(...)
 * ```
 */
export function defineEvents<
  const TExtends extends readonly DefinedEvents<any, any>[],
  const TSchema extends Record<string, unknown>,
  TEvents extends Record<string, unknown> = Merge<MergeDefinedEventSchemas<TExtends>, TSchema>,
>(
  options: DefineEventsOptions<TExtends, TSchema>,
): TEvents & DefinedEvents<TEvents, EventTreeDefinitions<TEvents>>;

export function defineEvents<
  const TEvents extends Record<string, unknown>,
  TDefinition extends object = EventTreeDefinitions<TEvents>,
>(schema: TEvents): TEvents & DefinedEvents<TEvents, TDefinition>;

export function defineEvents(
  schemaOrOptions:
    | Record<string, unknown>
    | DefineEventsOptions<readonly DefinedEvents<any, any>[], Record<string, unknown>>,
): Record<string, unknown> & DefinedEvents<Record<string, unknown>> {
  if (isDefineEventsOptions(schemaOrOptions)) {
    const merged = {};
    for (const events of schemaOrOptions.extends ?? []) {
      mergeEventTrees(merged, events as unknown as Record<string, unknown>);
    }
    mergeEventTrees(merged, schemaOrOptions.schema);
    return merged as Record<string, unknown> & DefinedEvents<Record<string, unknown>>;
  }

  return schemaOrOptions as unknown as Record<string, unknown> &
    DefinedEvents<Record<string, unknown>>;
}

function isDefineEventsOptions(
  value: unknown,
): value is DefineEventsOptions<readonly DefinedEvents<any, any>[], Record<string, unknown>> {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'schema' in value &&
    ((value as { extends?: unknown }).extends === undefined ||
      Array.isArray((value as { extends?: unknown }).extends)),
  );
}

function mergeEventTrees(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    if (
      isPlainObject(current) &&
      isPlainObject(value) &&
      !isSchemaLike(current) &&
      !isSchemaLike(value)
    ) {
      mergeEventTrees(current, value);
      continue;
    }

    target[key] = value;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSchemaLike(value: unknown): boolean {
  return Boolean(
    value && (typeof value === 'object' || typeof value === 'function') && '~standard' in value,
  );
}

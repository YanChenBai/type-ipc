import { fail } from './errors';
import type { AnySchema } from './types';
import type { HookStore } from './types';

export const builtInHandlerOptionKeys = new Set([
  'params',
  'response',
  'validateResponse',
  'metadata',
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
]);

export function emptyHooks<TContext extends object, TStore extends object>(): HookStore<
  TContext,
  TStore
> {
  return {
    onInvoke: [],
    onTransform: [],
    derive: [],
    resolve: [],
    onGuard: [],
    onBeforeHandle: [],
    onAfterHandle: [],
    onMapResponse: [],
    onError: [],
    onAfterResponse: [],
    onTrace: [],
  };
}

export function cloneHooks<TContext extends object, TStore extends object>(
  hooks: HookStore<TContext, TStore>,
): HookStore<TContext, TStore> {
  return {
    onInvoke: [...hooks.onInvoke],
    onTransform: [...hooks.onTransform],
    derive: [...hooks.derive],
    resolve: [...hooks.resolve],
    onGuard: [...hooks.onGuard],
    onBeforeHandle: [...hooks.onBeforeHandle],
    onAfterHandle: [...hooks.onAfterHandle],
    onMapResponse: [...hooks.onMapResponse],
    onError: [...hooks.onError],
    onAfterResponse: [...hooks.onAfterResponse],
    onTrace: [...hooks.onTrace],
  };
}

export function joinPath(...parts: string[]): string {
  return parts
    .flatMap(part => part.split('.'))
    .map(part => part.trim())
    .filter(Boolean)
    .join('.');
}

export function normalizeObjectParams(keyOrObject: string | object, value: unknown): object {
  if (typeof keyOrObject === 'string') return { [keyOrObject]: value };
  return keyOrObject;
}

export async function parseSchema(schema: AnySchema | undefined, value: unknown): Promise<unknown> {
  if (!schema) return value;
  const result = await schema['~standard'].validate(value);
  if ('issues' in result && result.issues) {
    throw fail('VALIDATION_ERROR', {
      message: result.issues.map(issue => issue.message).join('; '),
      data: result.issues,
    });
  }
  return result.value;
}

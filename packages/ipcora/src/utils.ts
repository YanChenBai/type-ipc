import type { AnySchema } from './host/types';

/**
 * Checks whether a value conforms to the Standard Schema v1 interface.
 * Returns `true` when the value has a `~standard.validate` function.
 */
export function isSchema(value: unknown): value is AnySchema {
  return Boolean(
    value &&
    (typeof value === 'object' || typeof value === 'function') &&
    '~standard' in value &&
    typeof (value as AnySchema)['~standard']?.validate === 'function',
  );
}

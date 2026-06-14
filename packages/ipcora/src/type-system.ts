import type { Simplify } from 'type-fest';

export type { Simplify };

/**
 * Merge two object types recursively while preserving ipcora's route/plugin
 * override semantics: nested plain objects merge, everything else is replaced
 * by the right-hand side.
 */
export type Merge<TLeft, TRight> = Simplify<
  Omit<TLeft, keyof TRight> & {
    [K in keyof TRight]: K extends keyof TLeft
      ? IsPlainObj<TLeft[K]> extends true
        ? IsPlainObj<TRight[K]> extends true
          ? Merge<TLeft[K], TRight[K]>
          : TRight[K]
        : TRight[K]
      : TRight[K];
  }
>;

/** Distributes over unions and returns `true` when `T` is a plain record. */
type IsPlainObj<T> = [T] extends [never]
  ? false
  : T extends (...args: any[]) => any
    ? false
    : T extends readonly any[]
      ? false
      : T extends object
        ? true
        : false;

/**
 * Convert a dot-separated path into a nested object tree.
 *
 * @example
 * `PathToObject<'window.open', Handler>` becomes
 * `{ window: { open: Handler } }`.
 */
export type PathToObject<
  TPath extends string,
  TValue,
> = TPath extends `${infer THead}.${infer TTail}`
  ? { [K in THead]: PathToObject<TTail, TValue> }
  : { [K in TPath]: TValue };

/**
 * Join a scope prefix and a local path while preserving literal string types.
 */
export type JoinPathType<TPrefix extends string, TPath extends string> = TPrefix extends ''
  ? TPath
  : TPath extends ''
    ? TPrefix
    : `${TPrefix}.${TPath}`;

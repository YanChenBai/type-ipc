import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { TSchema, TStatic } from '../typebox'

export type AnySchema = TSchema | StandardSchemaV1

export type Static<T extends AnySchema>
  = T extends TSchema ? TStatic<T>
    : T extends StandardSchemaV1<infer _In, infer Out> ? Out
      : never

export type Infer<T extends { static: any }> = T['static']

import type { AnySchema, Static, WebContentsSendData } from '../types'
import { webContents } from 'electron'
import { EMPTY_OBJECT, TYPE_IPC_SENDER_NAME } from '../constants'
import { parser } from '../utils'

export type SenderSchemaRecord = Record<string, AnySchema>

export interface LikeWebContents {
  send: (channel: string, ...args: any[]) => void
}

export type CreateSenderReturn<S extends SenderSchemaRecord | undefined> = Readonly<{
  [K in keyof S]: (data: S[K] extends AnySchema ? Static<S[K]> : S[K]) => Promise<void>
}>

export interface DefineSenderOptions {
  /**
   * Is validate data before send
   * @default false
   */
  validate?: boolean
}

export interface DefineSenderReturn {
  __sender_name: string
  static: any
  (webContents: LikeWebContents): Record<string, (data: any) => void>
}

/**
 * Define sender
 * @description If schema is undefined or options.validate is false, sender will not validate data
 * @example
 *
 * const createSender = defineSender('SenderName', { hello: Type.String() })
 * // or
 * const createSender = defineSender('SenderName', {} as { hello: string  })
 *
 * // send data to renderer
 * const sender = createSender(window.webContents)
 * sender.hello('world')
 */
export function defineSender<
  const Name extends string,
  const Schema extends (SenderSchemaRecord | Record<string, any>) | undefined,
  const Sender = CreateSenderReturn<Schema>,
>(
  name: Name,
  schema?: Schema,
  options?: DefineSenderOptions,
) {
  const senderMap = new WeakMap<LikeWebContents, any>()
  const hasSchema = schema && Object.keys(schema).length > 0
  const { validate = false } = options ?? {}

  const createSender = (webContents: LikeWebContents): Sender => {
    if (senderMap.has(webContents))
      return senderMap.get(webContents)!

    const methods = new Proxy(EMPTY_OBJECT, {
      get(_, method) {
        return async (data: unknown) => {
          if (typeof method !== 'string')
            throw new Error('Method name must be a string')

          // Only validate if schema exists and options.validate is true
          const parsedData = validate && hasSchema ? await parser(schema[method], data) : data

          const payload = {
            name,
            method,
            data: parsedData,
          } satisfies WebContentsSendData

          webContents.send(TYPE_IPC_SENDER_NAME, payload)
        }
      },
    }) as Sender

    senderMap.set(webContents, methods)
    return methods
  }

  return createSender as {
    (webContents: LikeWebContents): Sender
    __sender_name: Name
    /**
     * Generate static call signatures for the renderer side
     * @internal
     */
    static: {
      [K in keyof Sender as `on${string & K}` | `once${string & K}`]: Sender[K] extends (...args: any[]) => any
        ? (callback: (...args: Parameters<Sender[K]>) => Awaited<ReturnType<Sender[K]>>) => () => void
        : never
    }
  }
}

/**
 * Creates a message broadcaster that sends to specified or all webContents
 * @param sender Sender instance created by `defineSender`
 * @param webContentsList Optional array of target webContents (defaults to all)
 */
export function broadcastToWebContents<const Sender extends DefineSenderReturn>(sender: Sender, webContentsList?: LikeWebContents[]) {
  const senders = (webContentsList ?? webContents.getAllWebContents()).map(item => sender(item))

  return new Proxy(EMPTY_OBJECT, {
    get(_, method) {
      if (typeof method !== 'string')
        throw new Error('Method name must be a string')

      return (data: unknown) => {
        senders.forEach((sender) => {
          const func = sender[method]
          if (typeof func === 'function')
            func(data)
        })
      }
    },
  }) as Readonly<ReturnType<Sender>>
}

/**
 * This is a type-only function with no runtime implementation.
 * It serves purely as a type helper to infer and combine the static types.
 */
export function registerSenders<const Senders extends DefineSenderReturn[]>(..._senders: Senders) {
  return EMPTY_OBJECT as {
    /** @internal */
    static: {
      [K in Senders[number] as K['__sender_name']]: Readonly<K['static']>
    }
  }
}

export type {
  AnySchema,
  Static,
  WebContentsSendData,
}

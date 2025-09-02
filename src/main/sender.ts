import type { Static, TSchema } from '@sinclair/typebox'
import type { WebContentsSendData } from '../common'
import { Value } from '@sinclair/typebox/value'
import { BrowserWindow } from 'electron'
import { EMPTY_OBJECT, TYPE_IPC_SENDER_NAME } from '../common'

export type SenderSchemaRecord = Record<string, TSchema>

export type CreateSenderReturn<S extends SenderSchemaRecord | undefined> = Readonly<{
  [K in keyof S]: (data: S[K] extends TSchema ? Static<S[K]> : S[K]) => void
}>

export interface DefineSenderOptions {
  /**
   * Is validate data before send
   * @default false
   */
  validate?: boolean
}

export interface DefineSenderReturn {
  name: string
  static: any
  (window: BrowserWindow): any
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
 * const sender = createSender(window)
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
  const senderMap = new WeakMap<BrowserWindow, any>()
  const hasSchema = schema && Object.keys(schema).length > 0
  const { validate = false } = options ?? {}

  const createSender = (window: BrowserWindow): Sender => {
    if (senderMap.has(window))
      return senderMap.get(window)!

    const methods = new Proxy(EMPTY_OBJECT, {
      get(_, method) {
        return (data: unknown) => {
          if (typeof method !== 'string')
            throw new Error('Method name must be a string')

          // Only validate if schema exists and options.validate is true
          const parsedData = validate && hasSchema ? Value.Parse(schema[method], data) : data

          const payload = {
            name,
            method,
            data: parsedData,
          } satisfies WebContentsSendData

          window.webContents.send(TYPE_IPC_SENDER_NAME, payload)
        }
      },
    }) as Sender

    senderMap.set(window, methods)
    return methods
  }

  return createSender as {
    (window: BrowserWindow): Sender
    name: Name
    /**
     * Generate static call signatures for the renderer side
     * @internal
     */
    static: {
      [K in keyof Sender as `on${string & K}` | `once${string & K}`]: (callback: Sender[K]) => () => void
    }
  }
}

/**
 * Create sender for all windows
 * @param sender Created by `defineSender`
 */
export function createAllWindowsSender<const Sender extends DefineSenderReturn>(sender: Sender) {
  const senders = BrowserWindow.getAllWindows().map(window => sender(window))

  return new Proxy(EMPTY_OBJECT, {
    get(_, method) {
      return (data: unknown) => {
        senders.forEach((window) => {
          const methods = sender(window)
          if (typeof methods[method] === 'function')
            methods[method](data)
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
    static: { [K in Senders[number] as K['name']]: Readonly<K['static']> }
  }
}

export type {
  Static,
  TSchema,
  WebContentsSendData,
}

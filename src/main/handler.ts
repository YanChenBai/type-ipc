import type { Static, TSchema } from '@sinclair/typebox'
import type { IpcMainInvokeEvent } from 'electron'
import type { HandlerCallbackEvent } from '../common'
import { Value } from '@sinclair/typebox/value'
import { app, BaseWindow, BrowserWindow, ipcMain } from 'electron'
import { EMPTY_OBJECT, TYPE_IPC_HANDLER_NAME } from '../common'

export interface HandlerSchema {
  data: TSchema
  return: TSchema
}

export interface HandleListenerEvent {
  invokeEvent: IpcMainInvokeEvent
  baseWindow: BaseWindow | null
  browserWindow: BaseWindow | null
}

export type HandlerMethod<S extends HandlerSchema>
  = Static<S['data']> extends undefined
    ? (event: HandleListenerEvent) => Static<S['return']>
    : (event: HandleListenerEvent, data: Static<S['data']>) => Static<S['return']>

export type HandlerFromSchema<S extends Record<string, HandlerSchema>> = {
  [K in keyof S]: HandlerMethod<S[K]>
}

export interface DefineHandlerReturn {
  /**
   * @internal
   */
  __handler_name: string
  static: any
  (event: IpcMainInvokeEvent, invokeEvent: HandlerCallbackEvent): Promise<any>
}

export interface DefineHandlerOptions {
  /**
   * Is validate data before handle
   * @default false
   */
  validate?: boolean
}

/**
 * Define handlers
 * @example
 *
 * // use with schema
 * const myHandler = defineHandler('my-handlers', { }, { hello: { data: Type.String(), return: Type.String() } })
 *
 * // use without schema
 * const myHandler = defineHandler('my-handlers', { hello: (event, data) => 'Hello, world!' })
 *
 * // register
 * registerHandlers(myHandler)
 */
export function defineHandler<
  const Name extends string,
  const Methods extends Record<string, (event: HandleListenerEvent, args: any) => any>,
  const Schema extends Record<string, HandlerSchema> | undefined = undefined,
>(
  name: Name,
  methods: Schema extends Record<string, HandlerSchema> ? HandlerFromSchema<Schema> : Methods,
  schema?: Schema,
  options?: DefineHandlerOptions,
) {
  async function listener(event: IpcMainInvokeEvent, invokeEvent: HandlerCallbackEvent) {
    const { method, data } = invokeEvent
    const { validate = false } = options ?? {}
    const handler = methods[method]

    if (!handler)
      throw new Error(`Handler ${method} not found`)

    const handlerEvent = {
      invokeEvent: event,
      get baseWindow() {
        return BaseWindow.fromId(event.sender.id)
      },
      get browserWindow() {
        return BrowserWindow.fromId(event.sender.id)
      },
    }

    return await Promise.resolve(handler(
      handlerEvent,
      schema && validate
        ? Value.Parse(schema[method].data, data)
        : data,
    ))
  }

  listener.__handler_name = name

  return listener as {
    __handler_name: Name
    (event: IpcMainInvokeEvent, invokeEvent: HandlerCallbackEvent): Promise<any>

    /**
     * Generate static call signatures for the renderer side
     * @internal
     */
    static: {
      [K in keyof Methods]: Methods[K] extends (...args: any[]) => any
        ? (
            ...data: (Parameters<Methods[K]>['length'] extends 2
              ? Parameters<Methods[K]> extends [any, ...infer R]
                ? R : never
              : [])
          ) => Promise<{ error: null, data: Awaited<ReturnType<Methods[K]>> } | { error: Error, data: null }>
        : never
    }
  }
}

/**
 * Register handlers
 */
export function registerHandlers<const HandlerReturn extends DefineHandlerReturn[]>(...args: HandlerReturn) {
  let isStart = false
  const handlersMap = new Map(args.map(item => [item.__handler_name, item]))

  function start() {
    if (isStart)
      return

    isStart = true

    ipcMain.handle(TYPE_IPC_HANDLER_NAME, async (event, data: HandlerCallbackEvent) => {
      try {
        const listener = handlersMap.get(data.name)
        if (!listener)
          throw new Error(`Handler ${data.name} not found`)

        return {
          error: null,
          data: await listener(event, data),
        }
      }
      catch (error) {
        return {
          error,
          data: null,
        }
      }
    })
  }

  async function appWhenReadyStart() {
    return app.whenReady().then(() => {
      start()
    })
  }

  const returnValue = {
    /**
     * Start TypeIpc
     */
    start,

    /**
     * Start when app ready
     */
    appWhenReadyStart,

    /**
     * Add a handler
     */
    add<const A extends DefineHandlerReturn>(handler: A) {
      handlersMap.set(handler.__handler_name, handler)
      return returnValue as ReturnType<typeof registerHandlers<[...HandlerReturn, A]>>
    },

    /**
     * Delete a handler
     */
    del  <const A extends DefineHandlerReturn>(handler: A) {
      handlersMap.delete(handler.__handler_name)
    },

    /**
     * Generate static call signatures for the renderer side
     * @internal
     */
    static: EMPTY_OBJECT as { [K in HandlerReturn[number] as K['__handler_name']]: Readonly<K['static']> },
  }

  return returnValue
}

export type {
  HandlerCallbackEvent,
}

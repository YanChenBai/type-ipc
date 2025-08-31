import type { IpcRendererEvent } from 'electron'
import type { HandlerCallbackEvent, Infer, SenderCallbackEvent } from './common'
import { contextBridge, ipcRenderer } from 'electron'
import { formatSenderName, TYPE_IPC_EXPOSE_NAME, TYPE_IPC_HANDLER_NAME } from './common'

export function exposeTypeIpc() {
  contextBridge.exposeInMainWorld(TYPE_IPC_EXPOSE_NAME, {
    invoke(data: HandlerCallbackEvent) {
      return ipcRenderer.invoke(TYPE_IPC_HANDLER_NAME, data)
    },
    message({ name, method, callback }: SenderCallbackEvent) {
      // Remove name prefix `on`
      const channel = formatSenderName(name, method.substring(2))

      const cb = (_: IpcRendererEvent, data: any) => callback(data)

      ipcRenderer.on(channel, cb)

      return () => ipcRenderer.removeListener(channel, cb)
    },
  })
}

export type {
  HandlerCallbackEvent,
  Infer,
  IpcRendererEvent,
  SenderCallbackEvent,
}

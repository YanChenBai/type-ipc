export const EMPTY_OBJECT = Object.freeze({})
export const TYPE_IPC_EXPOSE_NAME = 'TypeIpc:Preload:Expose' as const
export const TYPE_IPC_HANDLER_NAME = 'TypeIpc:Main:Handler' as const
export const TYPE_IPC_SENDER_NAME = 'TypeIpc:Main:Sender' as const

export interface HandlerCallbackEvent {
  name: string
  method: string
  data?: any
}

export interface SenderCallbackEvent {
  name: string
  method: string
  callback: (data: any) => void
}

export interface WebContentsSendData {
  name: string
  method: string
  data?: any
}

export type Infer<T extends { static: any }> = T['static']

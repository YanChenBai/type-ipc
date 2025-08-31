# TypeIPC

一个端到端类型安全的IPC通讯的工具

## 使用方法

- Main Process

```typescript
// main.ts
import type { Infer } from 'type-ipc/main'
import { Type } from '@sinclair/typebox'
import { createHandler, registerHandlers } from 'type-ipc/main'

export const handler = createHandler('test', {
  ping: {
    data: Type.String(),
    return: Type.String(),
  }
})

const handlers = registerHandlers(handler, ...[])

handlers.start()

export type Invokes = Infer<typeof handlers>
```

- Preload Process

```typescript
// preload.ts
import { exposeTypeIpc } from 'type-ipc/preload'

exposeTypeIpc()
```

- 渲染进程调用:

```typescript
import type { Invoke, Message } from 'src/main/type-ipc'
import { createIpcInvoke, createIpcMessage } from 'type-ipc'

export const ipcInvoke = createIpcInvoke<Invoke>()
export const ipcMessage = createIpcMessage<Message>()

ipcInvoke.test.ping('hello').then((res) => {
  console.log(res)
})
```

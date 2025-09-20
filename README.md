# 📦 TypeIpc

一个端到端类型安全的 Electron IPC 通讯的工具

## ✨ 特性

- 🚀 端到端类型安全
- ⚡ 简单易用
- 📦 支持 Schema 验证 (使用 TypeBox)
- 🔧 灵活的 API 设计

## 📦 安装

```bash
# 使用 npm
npm install type-ipc

# 使用 pnpm
pnpm add type-ipc

# 使用 yarn
yarn add type-ipc

# 使用 bun
bun add type-ipc
```

## 🔨 使用示例

TypeIpc 提供了两种主要的通信模式：

1. **Handler / Invoke 模式** - 从渲染进程调用主进程函数并获取返回值
2. **Sender / Message 模式** - 从主进程向渲染进程发送消息

### 主进程 (Main Process)

```typescript
// main.ts
import type { Infer } from 'type-ipc/main'
import { Type } from '@sinclair/typebox'
import { defineHandler, defineSender, registerHandlers, registerSenders } from 'type-ipc/main'

// 定义 Handler - 用于处理从渲染进程发来的请求
export const handlers = defineHandler('test', {
  // 不带参数的函数
  ping: () => {
    console.log('pong')
    return 'pong'
  },

  // 带参数的函数
  greet: (event, name: string) => {
    return `Hello, ${name}!`
  },

  // 使用 TypeBox schema 验证参数
  add: (event, data: { a: number, b: number }) => {
    return data.a + data.b
  }
}, {
  // 对应的 TypeBox schema（可选）
  add: {
    data: Type.Object({
      a: Type.Number(),
      b: Type.Number()
    }),
    return: Type.Number()
  }
})

// 定义 Sender - 用于向渲染进程发送消息
export const createTestSender = defineSender('test', {
  // 定义可以发送的消息类型
  updateData: Type.String()
})

// 注册 handlers 和 senders
const registeredHandlers = registerHandlers(handlers)
const registeredSenders = registerSenders(createTestSender)

// 启动 IPC 监听
registeredHandlers.start()

// 导出类型供渲染进程使用
export type Invoke = Infer<typeof registeredHandlers>
export type Message = Infer<typeof registeredSenders>
```

### 预加载进程 (Preload Process)

```typescript
// preload.ts
import { exposeTypeIpc } from 'type-ipc/preload'

// 将 IPC 方法暴露给渲染进程
exposeTypeIpc()
```

### 渲染进程 (Renderer Process)

```typescript
// ipc.ts
import type { Invoke, Message } from '../main/main'
import { createIpcInvoke, createIpcMessage } from 'type-ipc/renderer'

// 创建 IPC 调用和消息监听实例
export const ipcInvoke = createIpcInvoke<Invoke>()
export const ipcMessage = createIpcMessage<Message>()
```

```vue
<!-- 在 Vue 组件中使用 -->
<script setup lang="ts">
import { ipcInvoke, ipcMessage } from './ipc'

// 调用主进程函数
async function handleClick() {
  // 调用无参数函数
  const pong = await ipcInvoke.test.ping()
  console.log(pong) // 'pong'

  // 调用带参数函数
  const greeting = await ipcInvoke.test.greet('World')
  console.log(greeting) // 'Hello, World!'

  // 调用带验证的函数
  const sum = await ipcInvoke.test.add({ a: 1, b: 2 })
  console.log(sum) // 3
}

// 监听主进程发送的消息
ipcMessage.test.onUpdateData((data) => {
  console.log('Received data:', data)
})

// 只监听一次主进程发送的消息
ipcMessage.test.onceUpdateData((data) => {
  console.log('Received data:', data)
})
</script>

<template>
  <button @click="handleClick">
    Send IPC
  </button>
</template>
```

### 从主进程发送消息到渲染进程

```typescript
// 在主进程中
import { BrowserWindow } from 'electron'
import { broadcastToWebContents } from 'type-ipc/main'

// 创建发送器实例
const sender = createTestSender(someBrowserWindow.webContents)
// 或者创建全局发送器（发送给所有窗口）
const globalSender = broadcastToWebContents(createTestSender)

// 发送消息
sender.updateData('Hello from main process!')
// 或者使用全局发送器
globalSender.updateData('Hello from main process!')
```

## 📚 API 介绍

### defineHandler(name, methods, schema?, options?)

定义一个处理器，用于处理从渲染进程发来的请求。

参数：

- `name`: 处理器名称
- `methods`: 方法对象，键为方法名，值为处理函数
- `schema`: （可选）TypeBox schema 对象，用于参数验证
- `options`: （可选）配置选项
  - `validate`: 是否启用参数验证（默认 false）

返回值：一个具有以下属性的函数：

- 函数本身：用于处理 IPC 调用的函数
- `__handler_name`: 处理器名称（内部使用）
- `static`: 类型定义，用于渲染进程的类型推断

### defineSender(name, schema?, options?)

定义一个发送器工厂函数，用于向渲染进程发送消息。

参数：

- `__sender_name`: 发送器名称
- `schema`: （可选）TypeBox schema 对象或 TypeScript 类型，定义可发送的消息类型
- `options`: （可选）配置选项
  - `validate`: 是否启用数据验证（默认 false）

返回值：一个具有以下属性的函数：

- 函数本身：接收一个 BrowserWindow 对象，返回一个发送器实例，该实例包含 schema 中定义的所有方法
- `name`: 发送器名称
- `static`: 类型定义，用于渲染进程的类型推断，会自动生成 `on` 和 `once` 前缀的监听方法

示例：

```typescript
const createTestSender = defineSender('test', {
  updateUser: Type.String(),
  updateConfig: Type.Object({
    theme: Type.String(),
    language: Type.String()
  })
})

// 使用时
const sender = createTestSender(someBrowserWindow)
sender.updateUser('John') // 发送消息
sender.updateConfig({ theme: 'dark', language: 'en' })
```

### registerHandlers(...handlers)

注册一个或多个处理器。

参数：

- `handlers`: 要注册的处理器（由 defineHandler 创建）

返回值：一个对象，包含以下属性和方法：

- `start()`: 启动 IPC 监听，开始处理来自渲染进程的请求
- `appWhenReadyStart()`: 在 Electron 应用准备就绪后启动 IPC 监听
- `add(handler)`: 动态添加处理器
- `del(handler)`: 动态删除处理器
- `static`: 类型定义，用于渲染进程的类型推断，是所有处理器 static 类型的交集

### registerSenders(...senders)

注册一个或多个发送器。

参数：

- `senders`: 要注册的发送器（由 defineSender 创建）

返回值：一个对象，包含以下属性：

- `static`: 类型定义，用于渲染进程的类型推断，是所有发送器 static 类型的交集
- `senders`: 当前注册的所有发送器

### broadcastToWebContents(sender, webContentsList)

创建一个可以向所有窗口发送消息的发送器。

参数：

- `sender`: 通过 defineSender 创建的发送器
- `webContentsList`: 要发送消息的 webbContents 数组, 默认为所有 webbContents

返回值：可以向所有窗口发送消息的发送器实例

### createIpcInvoke<Invoke>()

创建 IPC 调用实例，用于在渲染进程中调用主进程函数。

### createIpcMessage<Message>()

创建 IPC 消息监听实例，用于在渲染进程中监听主进程发送的消息。

### exposeTypeIpc()

在预加载脚本中调用，将 IPC 方法暴露给渲染进程。

## 🧪 测试

```bash
pnpm run test
```

## 📖 开发

```bash
# 开发模式
pnpm run dev

# 构建项目
pnpm run build
```

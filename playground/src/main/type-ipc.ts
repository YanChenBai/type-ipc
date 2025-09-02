import type { Infer } from 'type-ipc/main'
import process from 'node:process'
import { defineHandler, defineSender, registerHandlers, registerSenders } from 'type-ipc/main'

export const TestHandlers = defineHandler('test', {
  ping: (_event, data: string) => {
    // eslint-disable-next-line no-console
    console.log(data)
  },
  getVersions() {
    const { electron, chrome, node } = process.versions

    return {
      electron,
      chrome,
      node,
    }
  },
})

export const createTestSender = defineSender('test', {} as { Update: string })

export const handlers = registerHandlers(TestHandlers)
export const senders = registerSenders(createTestSender)

export type Invoke = Infer<typeof handlers>
export type Message = Infer<typeof senders>

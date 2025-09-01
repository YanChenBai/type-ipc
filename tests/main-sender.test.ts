import { Type } from '@sinclair/typebox'
import { describe, expect, it, vi } from 'vitest'
import { TYPE_IPC_SENDER_NAME } from '../src/common'
import { defineSender } from '../src/main/sender'

describe('defineSender', () => {
  it('should create a sender and send data', () => {
    const createSender = defineSender('TestSender', { hello: Type.String() })
    const mockWindow = { webContents: { send: vi.fn() } } as any

    const sender = createSender(mockWindow)
    sender.hello('world')

    expect(mockWindow.webContents.send)
      .toHaveBeenCalledWith(
        TYPE_IPC_SENDER_NAME,
        {
          name: 'TestSender',
          method: 'hello',
          data: 'world',
        },
      )
  })

  it('should cache sender per window', () => {
    const createSender = defineSender('TestSender', { hello: Type.String() })
    const mockWindow = { webContents: { send: vi.fn() } } as any

    const sender1 = createSender(mockWindow)
    const sender2 = createSender(mockWindow)

    expect(sender1).toBe(sender2)
  })

  it('should send data correctly when validate=true', () => {
    const createSender = defineSender('TestSender', { hello: Type.String() }, { validate: true })
    const mockWindow = { webContents: { send: vi.fn() } } as any
    const sender = createSender(mockWindow)

    sender.hello('world')

    expect(mockWindow.webContents.send).toHaveBeenCalledWith(
      TYPE_IPC_SENDER_NAME,
      {
        name: 'TestSender',
        method: 'hello',
        data: 'world',
      },
    )
  })

  it('should throw error when data does not match schema', () => {
    const createSender = defineSender('TestSender', { hello: Type.String() }, { validate: true })
    const mockWindow = { webContents: { send: vi.fn() } } as any
    const sender = createSender(mockWindow)

    expect(() => sender.hello({} as any)).toThrow()
    expect(mockWindow.webContents.send).not.toHaveBeenCalled()
  })
})
